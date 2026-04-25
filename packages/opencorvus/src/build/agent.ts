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
 *      format: json_schema(BuildResultSchema). The terminal StructuredOutput
 *      call is the agent's only way to return; text output is ignored.
 *   4. Finally block runs cleanupGoalWorkspace so the worktree dir, git
 *      branch, fsmonitor, and LSP servers all unwind regardless of outcome.
 *
 * No DB state. No GoalPool. No lease. No coordinator_run_id. Post-phase-5
 * every run is anchored to the child session (UI / audit) and the result
 * flows back as a tool_result to the orchestrator.
 */

import z from "zod"
import { Log } from "@/util/log"
import { resolveAgentModel } from "@/agent/model"
import { Provider } from "@/provider/provider"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import { Identifier } from "@/id/id"
import { Worktree } from "@/worktree"
import { BuildSemaphore } from "@/engine/build-semaphore"
import { Ownership } from "@/engine/ownership"
import { cleanupGoalWorkspace } from "@/goal/runner"
import { findActiveRunForTask, type TaskRow } from "@/engine/store"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import { BuildResultSchema, type BuildResult, type BuildTarget } from "./types"

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
    /** Sibling goals listed in `target.depends_on`. These already merged
     *  into the worktree base, but the agent benefits from seeing their
     *  titles + objectives so it knows what is already provided. */
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
    /** The terminal structured result the LLM emitted via StructuredOutput. */
    result: BuildResult
    /** The child "build" session created for this invocation. Callers may
     *  inspect its message stream for audit / UI. */
    sessionID: string
    /** The worktree directory used by this run. Absent when the caller
     *  supplied `workDir` (caller already has it). */
    worktreeDir?: string
  }

  /**
   * Run the build agent against a target. The returned promise resolves
   * with a BuildResult regardless of whether the agent's own verdict was
   * passed or failed; thrown errors are reserved for infrastructure faults
   * (model unavailable, worktree creation failed, session stream error).
   */
  export async function run(input: RunInput): Promise<RunOutput> {
    if (input.signal?.aborted) throw new Error("build agent aborted before start")

    let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
    if (input.model) {
      model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
    } else {
      model = await resolveAgentModel("build", { taskID: input.task.id }).catch(() => undefined)
    }
    if (!model) throw new Error("no LLM model available for build agent")

    return BuildSemaphore.withSlot(input.task, async () => {
      // ── Worktree acquisition ─────────────────────────────────────────────
      const ownsWorktree = !input.workDir
      let worktreeDir = input.workDir
      let worktreeBranch: string | undefined
      if (ownsWorktree) {
        const targetLabel = labelFromTarget(input.target)
        const info = await Worktree.create({ name: `build-${targetLabel}` })
        worktreeDir = info.directory
        worktreeBranch = info.branch
        // Record ownership marker so restart recovery can reclaim the dir
        // if this process dies mid-run.
        await Ownership.Worktree.record({
          primaryWorktreeDir: Instance.worktree,
          worktreeDir,
          taskID: input.task.id,
          sessionID: input.parentSessionID ?? "",
          runID: findActiveRunForTask(input.task.id)?.id,
          goalID: input.target.kind === "goal" ? input.target.id : undefined,
        })
      }

      // ── Child session ────────────────────────────────────────────────────
      const agentSession = await Session.createNext({
        kind: "build",
        parentID: input.parentSessionID,
        title: buildSessionTitle(input.target),
        directory: worktreeDir!,
      })

      // External signal → session cancel.
      const abortPrompt = () => {
        try {
          SessionPrompt.cancel(agentSession.id)
        } catch {
          /* session may already be stopped */
        }
      }
      input.signal?.addEventListener("abort", abortPrompt, { once: true })

      log.info("build agent starting", {
        taskID: input.task.id,
        sessionID: agentSession.id,
        target: input.target.kind,
        worktreeDir,
        model: model.id,
      })

      const userPrompt = buildUserPrompt(input.target, input.context)
      let finalMessage: Message.WithParts | undefined
      try {
        finalMessage = (await SessionPrompt.prompt({
          sessionID: agentSession.id,
          model: { providerID: model.providerID, modelID: model.api.id },
          agent: "build",
          system: BUILD_CORE,
          format: {
            type: "json_schema",
            schema: z.toJSONSchema(BuildResultSchema) as Record<string, unknown>,
            retryCount: 2,
          },
          parts: [{ type: "text", text: userPrompt, id: Identifier.ascending("part") }],
        })) as Message.WithParts
      } finally {
        input.signal?.removeEventListener("abort", abortPrompt)
        if (ownsWorktree && worktreeDir) {
          // Fire-and-forget cleanup — errors are logged inside cleanupGoalWorkspace.
          await cleanupGoalWorkspace(worktreeDir).catch((err) => {
            log.warn("build agent: cleanupGoalWorkspace failed", {
              worktreeDir,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        }
      }

      if (input.signal?.aborted) throw new Error("build agent aborted during prompt")
      if (!finalMessage) throw new Error("build agent: SessionPrompt.prompt returned no message")

      const structured = (finalMessage.info as Message.Assistant).structured
      const parsed = BuildResultSchema.safeParse(structured)
      if (!parsed.success) {
        throw new Error(
          `build agent: StructuredOutput payload did not match BuildResultSchema: ${parsed.error.message}`,
        )
      }

      log.info("build agent finished", {
        taskID: input.task.id,
        sessionID: agentSession.id,
        status: parsed.data.status,
        commit_ref: parsed.data.commit_ref,
        testCount: parsed.data.tests.length,
        worktreeBranch,
      })

      return {
        result: parsed.data,
        sessionID: agentSession.id,
        worktreeDir: ownsWorktree ? worktreeDir : undefined,
      }
    })
  }
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
      lines.push("## Dependencies (already merged into base branch)")
      lines.push("")
      lines.push(
        "These goals completed before yours. Their files are in your worktree; consume the exports they declared, do NOT re-implement them.",
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
      lines.push("**Acceptance Specs** (every one MUST be observably satisfied before status=passed):")
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
      "Open with `todowrite` to record the steps you intend to take (small, observable items) and update them as you progress so the overlay reflects state. Then: explore → implement within owned_paths → verify via bash → commit → call StructuredOutput exactly once.",
    )
    return lines.join("\n")
  }
  return [
    "# Request",
    "",
    target.text,
    "",
    "Open with `todowrite` to record your plan (small, observable steps) and update entries as you progress so the overlay reflects state. Then: explore the repo to understand scope, implement the change, verify via bash (tests / build / run), commit, and call StructuredOutput exactly once with your final report.",
  ].join("\n")
}
