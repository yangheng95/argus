/**
 * BuildAgent — phase 5-b-2 implementation of the `build` tool's agent body.
 *
 * Replaces the GoalPool + executor adapter path for coding work: instead of
 * delegating to an external coding executor (opencode / codex / claude-code),
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
 *      report_build_passed / report_build_failed terminal tools. The tool
 *      name is the status discriminator; text output is ignored.
 *   4. Finally block runs cleanupGoalWorkspace so the worktree dir, git
 *      branch, fsmonitor, and LSP servers all unwind regardless of outcome.
 *
 * No DB state. No GoalPool. No lease. No coordinator_run_id. Post-phase-5
 * every run is anchored to the child session (UI / audit) and the result
 * flows back as a tool_result to the orchestrator.
 */

import z from "zod"
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { tool, type ToolSet } from "ai"
import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Worktree } from "@/worktree"
import { BuildSemaphore } from "@/engine/build-semaphore"
import { Ownership } from "@/engine/ownership"
import { cleanupGoalWorkspace } from "@/goal/runner"
import { findActiveRunForTask, type TaskRow } from "@/engine/store"
import { EngineConfig } from "@/engine/config"
import { ExecutorRegistry } from "@/executor/registry"
import { record, structuredInput, type CodingEventInfo, type CodingProviderOptions } from "@/executor/contract"
import { Identifier } from "@/id/id"
import { Message } from "@/session/message"
import { MCPServe } from "@/mcp/serve"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { FileDiff } from "@/snapshot/types"
import { BuildResultSchema, type BuildResult, type BuildTarget } from "./types"
import { AttachmentStore } from "@/storage/attachment-store"
import { withStreamActivity } from "@/util/stream-activity"

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
     *  decision log. Each entry is either targeted at this goal explicitly
     *  or task-wide (goalIDs is empty / omitted). */
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
    /** Optional pre-allocated worktree dir. When provided, the build agent
     *  uses it as-is and does NOT manage its lifecycle (caller owns cleanup).
     *  When absent the agent creates + cleans its own worktree under
     *  `<primary>/.opencorvus/worktrees/`. */
    workDir?: string
  }

  export interface RunOutput {
    /** The terminal result the LLM emitted via report_build_passed / report_build_failed. */
    result: BuildResult
    /** The child "build" session created for this invocation. Callers may
     *  inspect its message stream for audit / UI. */
    sessionID: string
    /** The worktree directory used by this run. Absent when the caller
     *  supplied `workDir` (caller already has it). */
    worktreeDir?: string
    /** Per-file diffs from worktree base → goal branch HEAD. Captured before
     *  cleanup so the orchestrator can persist a per-goal delivery artifact
     *  the overlay's right-side panel reads via `findDeliveryByGoalRun`.
     *  Empty / undefined when no merge-back happened (failed build, caller-
     *  owned worktree, or no commit_ref). */
    diffs?: FileDiff[]
  }

  export function composeExternalCodingSystem(input: {
    executor: Exclude<TaskRow["executor"], "opencode">
    baseSystem?: string
    skillPrompt?: string
  }) {
    const mcpPrompt = input.executor === "codex"
      ? MCPServe.codingExecutorPromptSection()
      : ""
    const system = [input.baseSystem ?? "", mcpPrompt, input.skillPrompt ?? ""]
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
      // ── Worktree acquisition ─────────────────────────────────────────────
      // Happens OUTSIDE runAgentSession because the worktree is the
      // session's working directory — the runner needs it resolved before
      // it calls Session.createNext. When ownsWorktree is false, the
      // caller (re-attempt / user-preallocated dir) is responsible for
      // cleanup; we neither create nor clean up the directory.
      const ownsWorktree = !input.workDir
      let worktreeDir = input.workDir
      let worktreeBranch: string | undefined
      // Worktree HEAD commit at creation time. Equals primary HEAD because
      // Worktree.create branches off it; we capture the SHA so post-build
      // diff extraction can compute baseRef..HEAD inside the worktree
      // without depending on git merge-base (which fails after merge-back
      // when ff-only collapses both refs to the same tip).
      let baseRef: string | undefined
      if (ownsWorktree) {
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
        baseRef = (await $`git rev-parse HEAD`.quiet().nothrow().cwd(worktreeDir).text()).trim() || undefined
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
            const { referenceOnly } = AttachmentStore.partition(allMultimodal)
            const inline = await AttachmentStore.inlineFileParts(allMultimodal)
            // Three layers of context for attachments, each with a different
            // role and required to coexist (rule 22 — staging doesn't
            // replace inlining; inlining doesn't replace listing):
            //   1. inline file parts → the LLM physically sees the pixels
            //   2. renderStagedList → tells the LLM the worktree-local path
            //      so it can pass them to sandbox-checked tools
            //   3. renderReferenceList → URL list for non-multimodal refs
            //      that can't be inlined and aren't staged
            const enrichedText =
              text +
              AttachmentStore.renderStagedList(stagedAttachments) +
              AttachmentStore.renderReferenceList(referenceOnly)
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

      type BuildCollector = {
        result?: BuildResult
        blockedBeforeMerge: boolean
      }
      const buildCollector: BuildCollector = { blockedBeforeMerge: false }
      const createBuildReportTools = (): ToolSet => ({
        report_build_passed: tool({
          description:
            "Finalize a successful build after implementation, verification, commit, and merge_back have all succeeded. " +
            "Do not call this before merge_back reports status='merged'.",
          inputSchema: z.object({
            summary: z.string().min(1).describe("One-line plain-prose description of what changed."),
            patch_summary: z.string().describe("Short bullet list of file-level changes."),
            tests: z.array(z.object({
              name: z.string().min(1),
              passed: z.boolean(),
              detail: z.string().optional(),
            })).default([]),
          }),
          execute: async ({ summary, patch_summary, tests }) => {
            if (ownsWorktree && worktreeBranch && !mergedHead) {
              buildCollector.blockedBeforeMerge = true
              return (
                "Error: cannot report_build_passed before merge_back succeeds. " +
                "Commit the fix, call merge_back, resolve any conflicts, and call report_build_passed only after merge_back returns status='merged'."
              )
            }
            buildCollector.result = {
              status: "passed",
              summary,
              patch_summary,
              commit_ref: mergedHead ? mergedHead.slice(0, 12) : "",
              tests: tests ?? [],
            }
            return "PASS: build result recorded."
          },
        }),
        report_build_failed: tool({
          description:
            "Finalize a failed build with the concrete blocker after implementation or verification could not be completed.",
          inputSchema: z.object({
            summary: z.string().min(1).describe("One-line plain-prose description of what failed."),
            error: z.string().min(1).describe("Concrete failure reason."),
            patch_summary: z.string().optional().describe("Short bullet list of partial file-level changes, if any."),
            tests: z.array(z.object({
              name: z.string().min(1),
              passed: z.boolean(),
              detail: z.string().optional(),
            })).default([]),
          }),
          execute: async ({ summary, error, patch_summary, tests }) => {
            buildCollector.result = {
              status: "failed",
              summary,
              patch_summary: patch_summary ?? "",
              commit_ref: mergedHead ? mergedHead.slice(0, 12) : "",
              tests: tests ?? [],
              error,
            }
            return "PASS: build failure recorded."
          },
        }),
      })

      const buildToolKit: { tools: ToolSet; getCollector: () => BuildCollector } = ownsWorktree && worktreeBranch && worktreeDir
        ? {
            tools: {
              merge_back: tool({
                description:
                  "Publish your goal branch's commits onto the project's primary " +
                  "branch (main/master). Runs `git rebase <primary>` inside this " +
                  "worktree, then `git merge --ff-only` on the primary worktree, " +
                  "atomically under a host-side lock so concurrent goals do not " +
                  "race each other.\n\n" +
                  "Call this AFTER you have committed all your changes and your " +
                  "verification passed, and BEFORE calling report_build_passed. It " +
                  "is the LAST git-affecting action of the session.\n\n" +
                  "Returns one of:\n" +
                  "  • {status:'merged', primary_head, primary_branch} — done; emit " +
                  "    report_build_passed.\n" +
                  "  • {status:'conflict', primary_branch, primary_tip, " +
                  "    conflict_paths[]} — rebase hit textual conflicts and was " +
                  "    aborted (your branch is back to its pre-rebase tip). Read " +
                  "    each conflict path on both sides via `git show " +
                  "    <primary>:<path>` and your worktree, reconcile manually, " +
                  "    `git add` + `git commit`, then call merge_back again.\n" +
                  "  • {status:'error', reason} — infrastructure problem; report it " +
                  "    via report_build_failed.",
                inputSchema: z.object({}),
                execute: async () => {
                  try {
                    const result = await Worktree.mergeWithRebase({
                      branch: worktreeBranch!,
                      worktreeDir: worktreeDir!,
                    })
                    mergedHead = result.primaryHead
                    return {
                      status: "merged" as const,
                      primary_head: result.primaryHead,
                      primary_branch: result.primaryBranch,
                    }
                  } catch (err) {
                    if (err instanceof Worktree.MergeConflictError) {
                      const data = (err as { data: {
                        branch: string
                        primaryBranch: string
                        primaryTip: string
                        conflictPaths: string[]
                      } }).data
                      return {
                        status: "conflict" as const,
                        primary_branch: data.primaryBranch,
                        primary_tip: data.primaryTip,
                        conflict_paths: data.conflictPaths,
                        hint:
                          "Rebase aborted; branch restored. Read each path on " +
                          "both sides (git show " + data.primaryBranch + ":<path> vs your " +
                          "worktree), reconcile, git add + git commit, then call " +
                          "merge_back again.",
                      }
                    }
                    return {
                      status: "error" as const,
                      reason: err instanceof Error ? err.message : String(err),
                    }
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
      // When the agent tries to close with status=passed before merge_back,
      // report_build_passed is rejected in-session. If the model still fails to
      // repair that by calling merge_back, preserve the worktree so the next
      // attempt can continue from the written files instead of discarding
      // real progress.
      let preserveWorktreeForRetry = false
      let mergeBackBlockedReport = false
      // Dispatch fork: executor === "opencode" → in-process LLM via SessionPrompt
      // (the existing runAgentSession path with merge_back tool). Anything else
      // (claude-code, codex) → external CodingProvider; the provider edits files
      // in the worktree on its own, then BuildAgent runs merge_back itself
      // because the SDK has no way to call our merge_back tool.
      const executor = input.task.executor ?? "opencode"
      try {
        if (executor === "opencode") {
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
          })
          const report = buildToolKit.getCollector()
          out = { ...out, collector: report }
          mergeBackBlockedReport = report.blockedBeforeMerge
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
          })
          out = { session: { id: externalOut.sessionID }, structured: externalOut.structured }
          parsed = BuildResultSchema.safeParse(externalOut.structured)
          if (externalOut.mergedHead) mergedHead = externalOut.mergedHead
        }

        // Capture the goal's diff against its original baseRef while the
        // worktree's git dir is still healthy — overlay's per-goal delivery
        // panel reads this. Independent of merge outcome (we still want to
        // show what the agent changed even if the merge step was skipped).
        if (
          ownsWorktree &&
          worktreeDir &&
          baseRef &&
          parsed.success &&
          parsed.data.status === "passed"
        ) {
          diffs = await collectGoalDiffs(worktreeDir, baseRef).catch((err) => {
            log.warn("build agent: collectGoalDiffs failed — overlay panel will show empty file list", {
              taskID: input.task.id,
              error: err instanceof Error ? err.message : String(err),
            })
            return undefined
          })
        }

        // Decide before the finally cleanup whether the next attempt should
        // be allowed to pick up where this one left off. The continuable
        // cases are: the model reported passed without merge_back after the
        // guard rejected that report_build_passed, or an older path somehow
        // returned a passed payload without a merged head.
        if (
          ownsWorktree &&
          worktreeBranch &&
          !mergedHead &&
          (
            mergeBackBlockedReport ||
            (parsed?.success && parsed.data.status === "passed")
          )
        ) {
          preserveWorktreeForRetry = true
        }
      } finally {
        if (ownsWorktree && worktreeBranch && !mergedHead && mergeBackBlockedReport) {
          preserveWorktreeForRetry = true
        }
        if (ownsWorktree && worktreeDir && !preserveWorktreeForRetry) {
          await cleanupGoalWorkspace(worktreeDir).catch((err) => {
            log.warn("build agent: cleanupGoalWorkspace failed", {
              worktreeDir,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        } else if (preserveWorktreeForRetry && worktreeDir) {
          log.warn("build agent: preserving worktree for retry — merge_back contract incomplete", {
            taskID: input.task.id,
            worktreeDir,
            worktreeBranch,
          })
        }
      }

      if (!parsed || !parsed.success) {
        if (mergeBackBlockedReport) {
          parsed = {
            success: true as const,
            data: {
              status: "failed" as const,
              summary: "Build session ended before merge_back completed.",
              patch_summary: "",
              tests: [],
              error:
                "report_build_passed was rejected because merge_back had not succeeded; " +
                "the model did not repair the session by calling merge_back before the run ended.",
            },
          }
        }
      }

      if (!parsed || !parsed.success) {
        throw new Error(
          `build agent: terminal build report did not match BuildResultSchema: ${parsed?.error?.message ?? "(no parsed output)"}`,
        )
      }

      // Post-run guard. Contract is "merge_back must happen inside the build
      // session before the build returns passed". Caller-owned worktrees opt
      // out because the caller publishes those changes.
      if (
        ownsWorktree &&
        worktreeBranch &&
        parsed.data.status === "passed" &&
        !mergedHead
      ) {
        parsed = {
          success: true as const,
          data: {
            ...parsed.data,
            status: "failed" as const,
            error:
              "merge_back was not called or did not succeed inside the build session; " +
              "goal never published to primary (切法-A: build agent owns merge).",
          },
        }
      } else if (mergedHead && parsed.data.status === "passed") {
        // Rewrite commit_ref to the merged primary HEAD so downstream readers
        // (delivery overlay, evaluator) point at the published commit, not
        // the agent's pre-rebase tip (which may differ after rebase replay).
        parsed = {
          success: true as const,
          data: { ...parsed.data, commit_ref: mergedHead.slice(0, 12) },
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

      return {
        result: parsed.data,
        sessionID: out.session.id,
        worktreeDir: ownsWorktree ? worktreeDir : undefined,
        diffs,
      }
    })
  }
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
  return "tool"
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

function externalEventPartText(event: CodingEventInfo, executor: string): string | undefined {
  // Progress events are intentionally NOT rendered as user-visible parts:
  // claude-code + codex both emit a stream of fine-grained "Phase: X" /
  // "Summary: Y" pings that bury the actual conversation under noise.
  // The events still flow through the events[] array (so logs/diagnostics
  // see them) — only the chat-card materialisation is dropped. Plan/diff/
  // approval/input/usage/error remain visible because those carry decisions
  // the operator needs to see.
  if (event.type === "plan_delta") {
    const summary = event.summary?.trim()
    return summary ? `**${executor} plan**\n\n${summary}` : undefined
  }
  if (event.type === "diff_delta") {
    const summary = event.summary?.trim()
    return summary ? `**${executor} diff**\n\n${summary}` : undefined
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
    const lines = [`**${executor} usage**`]
    if (event.inputTokens !== undefined) lines.push(`Input tokens: ${event.inputTokens}`)
    if (event.outputTokens !== undefined) lines.push(`Output tokens: ${event.outputTokens}`)
    if (event.totalTokens !== undefined) lines.push(`Total tokens: ${event.totalTokens}`)
    if (event.costUSD !== undefined) lines.push(`Cost USD: ${event.costUSD}`)
    return lines.length > 1 ? lines.join("\n") : undefined
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
 * post-run path is identical for opencode and external executors (rule 22:
 * single contract, multiple implementations).
 */
async function runWithExternalProvider(args: {
  executor: Exclude<TaskRow["executor"], "opencode">
  target: BuildTarget
  taskID: string
  parentSessionID?: string
  worktreeDir: string
  worktreeBranch: string | undefined
  ownsWorktree: boolean
  buildPromptText: () => string
  taskSignals?: import("@/engine/skill-inject").TaskSignals
  signal?: AbortSignal
}): Promise<{ sessionID: string; structured: unknown; mergedHead?: string }> {
  const { provider, options } = ExecutorRegistry.requireCoding(args.executor)

  const session = await Session.createNext({
    kind: "build",
    parentID: args.parentSessionID,
    goalID: args.target.kind === "goal" ? args.target.id : undefined,
    title: buildSessionTitle(args.target),
    directory: args.worktreeDir,
  })

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

  // Live part trackers — events stream in async; we keep open part rows for
  // text/reasoning to extend, and a callID→ToolPart map so tool_result can
  // upgrade pending → completed without a second lookup.
  let activeText: { id: string; buf: string } | undefined
  let activeReasoning: { id: string; buf: string; start: number } | undefined
  const tools = new Map<string, {
    id: string
    name: string
    input: Record<string, unknown>
    metadata: Record<string, unknown>
    start: number
  }>()

  const flushText = async (final: boolean) => {
    if (!activeText) return
    await Session.updatePart({
      id: activeText.id,
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "text",
      text: activeText.buf,
    })
    if (final) activeText = undefined
  }

  const flushReasoning = async (final: boolean) => {
    if (!activeReasoning) return
    await Session.updatePart({
      id: activeReasoning.id,
      sessionID: session.id,
      messageID: assistantMessageID,
      type: "reasoning",
      text: activeReasoning.buf,
      time: { start: activeReasoning.start, ...(final ? { end: Date.now() } : {}) },
    })
    if (final) activeReasoning = undefined
  }

  const appendExternalEventPart = async (event: CodingEventInfo) => {
    const text = externalEventPartText(event, args.executor)
    if (!text) return
    if (activeText) await flushText(true)
    if (activeReasoning) await flushReasoning(true)
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
  // opencode path uses, and append the skill bundle (stage invariant + matched
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
          if (activeReasoning) await flushReasoning(true)
          if (!activeText) activeText = { id: Identifier.ascending("part"), buf: "" }
          activeText.buf += event.text
          textCharCount += event.text.length
          await flushText(false)
          break
        }
        case "reasoning_delta": {
          if (activeText) await flushText(true)
          if (!activeReasoning) {
            activeReasoning = { id: Identifier.ascending("part"), buf: "", start: Date.now() }
          }
          activeReasoning.buf += event.text
          await flushReasoning(false)
          break
        }
        case "tool_call": {
          toolUseCount += 1
          if (activeText) await flushText(true)
          if (activeReasoning) await flushReasoning(true)
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
          if (!t) toolUseCount += 1
          const end = Date.now()
          const name = t?.name ?? externalToolResultName(event)
          const input = t?.input ?? externalToolResultInput(event)
          const metadata = { ...(t?.metadata ?? {}), ...externalToolMetadata(event) }
          await Session.updatePart({
            id: t?.id ?? Identifier.ascending("part"),
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
        case "approval_request":
        case "input_request":
        case "usage":
          await appendExternalEventPart(event)
          break
        case "done":
          doneOutput = event.output ?? undefined
          break
        case "error":
          await appendExternalEventPart(event)
          errored = event.message
          break
      }
      if (event.type === "done" || event.type === "error") break
    }
  } catch (err) {
    errored = err instanceof Error ? err.message : String(err)
  } finally {
    gate.dispose()
  }

  // Finalize any open parts so overlay sees the closing state.
  if (activeText) await flushText(true)
  if (activeReasoning) await flushReasoning(true)
  for (const [callID, t] of tools) {
    const end = Date.now()
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
        error: "tool_call had no matching tool_result before stream end",
        metadata: t.metadata,
        time: { start: t.start, end },
      },
      metadata: t.metadata,
    })
  }
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
        summary: `external executor ${args.executor} reported error: ${errored}`,
        patch_summary: "",
        tests: [],
        error: errored,
      },
    }
  }

  // External provider finished without error; BuildAgent owns merge_back.
  if (!args.ownsWorktree || !args.worktreeBranch) {
    // Caller-owned worktree: skip merge here, caller will publish.
    return {
      sessionID: session.id,
      structured: {
        status: "passed" as const,
        commit_ref: "",
        summary:
          doneOutput?.trim() ||
          `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
        patch_summary: "",
        tests: [],
      },
    }
  }

  let mergedHead: string | undefined
  try {
    const result = await Worktree.mergeWithRebase({
      branch: args.worktreeBranch,
      worktreeDir: args.worktreeDir,
    })
    mergedHead = result.primaryHead
  } catch (err) {
    if (err instanceof Worktree.MergeConflictError) {
      const data = (err as { data: { branch: string; primaryBranch: string; primaryTip: string; conflictPaths: string[] } }).data
      return {
        sessionID: session.id,
        structured: {
          status: "failed" as const,
          commit_ref: "",
          summary: `merge_back conflict on ${args.worktreeBranch} → ${data.primaryBranch}`,
          patch_summary: "",
          tests: [],
          error: `Rebase aborted: conflict paths ${data.conflictPaths.join(", ")}`,
        },
      }
    }
    return {
      sessionID: session.id,
      structured: {
        status: "failed" as const,
        commit_ref: "",
        summary: `merge_back error on ${args.worktreeBranch}`,
        patch_summary: "",
        tests: [],
        error: err instanceof Error ? err.message : String(err),
      },
    }
  }

  return {
    sessionID: session.id,
    structured: {
      status: "passed" as const,
      commit_ref: mergedHead.slice(0, 12),
      summary:
        doneOutput?.trim() ||
        `external executor ${args.executor} completed (${events.length} events, ${toolUseCount} tool-uses, ${textCharCount} chars)`,
      patch_summary: "",
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
 * Collect per-file diffs for the goal's worktree branch as `baseRef..HEAD`.
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
  const headRaw = (await $`git rev-parse HEAD`.quiet().nothrow().cwd(worktreeDir).text()).trim()
  if (!headRaw || headRaw === baseRef) return []

  const status = new Map<string, "added" | "deleted" | "modified">()
  const statusOut = (
    await $`git -c core.quotepath=false diff --no-ext-diff --name-status --no-renames ${baseRef} ${headRaw} -- .`
      .quiet()
      .nothrow()
      .cwd(worktreeDir)
      .text()
  ).trim()
  for (const line of statusOut.split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    const kind = code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified"
    status.set(file, kind)
  }

  const numstatOut = (
    await $`git -c core.quotepath=false diff --no-ext-diff --no-renames --numstat ${baseRef} ${headRaw} -- .`
      .quiet()
      .nothrow()
      .cwd(worktreeDir)
      .text()
  ).trim()

  const result: FileDiff[] = []
  for (const line of numstatOut.split("\n")) {
    if (!line) continue
    const [additions, deletions, file] = line.split("\t")
    if (!file) continue
    if (file.startsWith(".opencorvus/") || file === ".opencorvus-meta.json") continue
    const isBinary = additions === "-" && deletions === "-"
    const before = isBinary
      ? ""
      : (await $`git show ${baseRef}:${file}`.quiet().nothrow().cwd(worktreeDir).text())
    const after = isBinary
      ? ""
      : (await $`git show ${headRaw}:${file}`.quiet().nothrow().cwd(worktreeDir).text())
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

function buildUserPrompt(target: BuildTarget, context?: BuildAgent.BuildContext): string {
  if (target.kind === "goal") {
    const lines: string[] = []

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

    const contracts = (context?.architectContracts ?? []).filter((c) => {
      if (!c.goalIDs || c.goalIDs.length === 0) return true // task-wide
      return c.goalIDs.includes(target.id)
    })
    if (contracts.length > 0) {
      lines.push("## Architect Contracts (cross-goal consensus, must honour)")
      lines.push("")
      lines.push(
        "The architect committed these interface contracts to the decision log. They are binding: violating them will fail the integration merge.",
      )
      lines.push("")
      for (const c of contracts) {
        const scope = c.goalIDs && c.goalIDs.length === 1 ? "(this goal)" : "(task-wide)"
        lines.push(`### ${c.title} — ${c.category} ${scope}`)
        lines.push(c.spec)
        lines.push("")
      }
    }

    const deps = context?.dependencies ?? []
    if (deps.length > 0) {
      lines.push("## Dependencies (should be merged into your worktree base)")
      lines.push("")
      lines.push(
        "These goals are listed as prerequisites — the orchestrator is supposed to have waited for them to pass and merge before dispatching you, so their files SHOULD already exist in your base branch. Verify by reading them before you consume their exports. If a declared export is missing or the file is absent, do NOT re-implement it: call `report_build_failed` with a concrete error naming the missing dependency so the orchestrator can fix the dispatch order.",
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
          "The visual contract below came from design_analysis. Implement the subset relevant to this goal's owned files, UI surface, and interactions; ignore specs targeting unrelated regions.",
        ],
      }))
      lines.push("")
    }

    if (context?.retryFeedback && context.retryFeedback.trim().length > 0) {
      lines.push(context.retryFeedback)
      lines.push("")
    }

    // ── Goal contract ────────────────────────────────────────────────────
    lines.push(`# Goal: ${target.title}`)
    lines.push("")
    lines.push(`**Objective**: ${target.objective}`)
    if (target.acceptance_specs.length > 0) {
      lines.push("")
      lines.push("**Acceptance Specs** (every one MUST be observably satisfied before report_build_passed):")
      for (const spec of target.acceptance_specs) lines.push(`- ${spec}`)
    }
    if (target.owned_paths.length > 0) {
      lines.push("")
      lines.push(`**Owned Paths** (exclusive write access): ${target.owned_paths.join(", ")}`)
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
    lines.push(
      "Explore → implement within owned_paths → verify via bash → commit → call report_build_passed or report_build_failed exactly once.",
    )
    return lines.join("\n")
  }
  return [
    "# Request",
    "",
    target.text,
    "",
    "Explore the repo to understand scope, implement the change, verify via bash (tests / build / run), commit, and call report_build_passed or report_build_failed exactly once with your final report.",
  ].join("\n")
}
