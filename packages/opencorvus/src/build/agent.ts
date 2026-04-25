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
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Worktree } from "@/worktree"
import { BuildSemaphore } from "@/engine/build-semaphore"
import { Ownership } from "@/engine/ownership"
import { cleanupGoalWorkspace } from "@/goal/runner"
import { findActiveRunForTask, type TaskRow } from "@/engine/store"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { FileDiff } from "@/snapshot/types"
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
    /** Per-file diffs from worktree base → goal branch HEAD. Captured before
     *  cleanup so the orchestrator can persist a per-goal delivery artifact
     *  the overlay's right-side panel reads via `findDeliveryByGoalRun`.
     *  Empty / undefined when no merge-back happened (failed build, caller-
     *  owned worktree, or no commit_ref). */
    diffs?: FileDiff[]
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
        const info = await Worktree.create({ name: `build-${targetLabel}` })
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

      // Stage-skill injection for build: the resolved skill block is
      // appended to the USER prompt (not the system prompt) — unusual
      // among agents, but a deliberate legacy of the pre-phase-5
      // buildGoalPrompt path. Kept as-is; the runner's `skillsStage`
      // parameter would put it on the system side, which build's
      // existing tests assume it does not.
      const taskSignals: import("@/engine/skill-inject").TaskSignals = {
        has_attachment_image: Array.isArray(input.task.attachments)
          && input.task.attachments.some((a: any) => typeof a?.mime === "string" && a.mime.startsWith("image/")),
        request_contains_url: /\bhttps?:\/\/\S+/i.test(input.task.request ?? ""),
        request_text: input.task.request ?? "",
      }
      const { resolveStageSkills } = await import("@/engine/skill-inject")
      const skillResolution = await resolveStageSkills([], "build", taskSignals).catch((err) => {
        log.warn("build agent: stage-skill injection failed — proceeding without skills", {
          error: err instanceof Error ? err.message : String(err),
        })
        return { prompt: "", skills: [], requiredTools: [] }
      })
      const skillPrompt = skillResolution.prompt

      const buildPromptText = () =>
        [buildUserPrompt(input.target, input.context), skillPrompt]
          .filter((s) => typeof s === "string" && s.trim().length > 0)
          .join("\n\n")

      let out
      let parsed: ReturnType<typeof BuildResultSchema.safeParse> | undefined
      let diffs: FileDiff[] | undefined
      try {
        out = await runAgentSession({
          kind: "build",
          core: BUILD_CORE,
          sessionTitle: buildSessionTitle(input.target),
          sessionDirectory: worktreeDir!,
          parentSessionID: input.parentSessionID,
          taskID: input.task.id,
          model: input.model,
          signal: input.signal,
          // Build's ambient toolset is surfaced through the agent system
          // (bash / read / write / edit / …); runner registers no extra
          // agent-scoped tools on top. Empty tool kit + runner-supplied
          // enableMap means the build agent sees its default tools via
          // SessionPrompt.prompt's normal resolution path.
          toolKit: {
            tools: {},
            getCollector: () => undefined as unknown,
          },
          buildUserPrompt: buildPromptText,
          format: {
            schema: z.toJSONSchema(BuildResultSchema) as Record<string, unknown>,
            retryCount: 2,
          },
        })
        parsed = BuildResultSchema.safeParse(out.structured)
        if (parsed.success) {
          parsed = BuildResultSchema.safeParse(await enforceBuildSkillEvidence({
            result: parsed.data,
            requiredTools: skillResolution.requiredTools,
            sessionID: out.session.id,
            worktreeDir: worktreeDir ?? Instance.directory,
          }))
        }
        // Fast-forward merge the goal branch back into primary HEAD before
        // teardown. This is the standard git-worktree pattern: branch off
        // primary → work in worktree → merge back so the next worktree (and
        // any cross-goal artifact like `mirror/`) inherits the work via git.
        // Skipped on:
        //  - caller-owned worktrees (input.workDir set) — caller manages git
        //  - structured-output failures or non-passed verdicts — there's
        //    nothing useful to publish to primary
        // ff-only is intentional (rule 1): a divergence here means another
        // goal already merged conflicting work, and the conflict must be
        // surfaced to the orchestrator, not silently three-way merged.
        if (
          ownsWorktree &&
          worktreeBranch &&
          parsed.success &&
          parsed.data.status === "passed" &&
          parsed.data.commit_ref
        ) {
          // Capture diffs BEFORE merge-back so the worktree's own git can
          // resolve `<baseRef>..HEAD` without ambiguity. Merge is ff-only,
          // so primary's HEAD will equal the worktree's branch tip after —
          // collecting after the merge would still work, but doing it here
          // keeps both operations bound to the worktree's own git dir.
          if (baseRef && worktreeDir) {
            diffs = await collectGoalDiffs(worktreeDir, baseRef).catch((err) => {
              log.warn("build agent: collectGoalDiffs failed — overlay panel will show empty file list", {
                taskID: input.task.id,
                error: err instanceof Error ? err.message : String(err),
              })
              return undefined
            })
          }
          await Worktree.mergeIntoPrimary({ branch: worktreeBranch })
          log.info("build agent: merged goal branch into primary", {
            taskID: input.task.id,
            branch: worktreeBranch,
            commit_ref: parsed.data.commit_ref,
            diffFiles: diffs?.length ?? 0,
          })
        }
      } finally {
        if (ownsWorktree && worktreeDir) {
          await cleanupGoalWorkspace(worktreeDir).catch((err) => {
            log.warn("build agent: cleanupGoalWorkspace failed", {
              worktreeDir,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        }
      }

      if (!parsed || !parsed.success) {
        throw new Error(
          `build agent: StructuredOutput payload did not match BuildResultSchema: ${parsed?.error?.message ?? "(no parsed output)"}`,
        )
      }

      log.info("build agent finished", {
        taskID: input.task.id,
        sessionID: out.session.id,
        status: parsed.data.status,
        commit_ref: parsed.data.commit_ref,
        testCount: parsed.data.tests.length,
        worktreeBranch,
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

type BuildSkillFailure = { name: string; detail: string }

async function enforceBuildSkillEvidence(input: {
  result: BuildResult
  requiredTools: string[]
  sessionID: string
  worktreeDir: string
}): Promise<BuildResult> {
  const requiredTools = Array.from(new Set(input.requiredTools))
  if (input.result.status !== "passed" || requiredTools.length === 0) return input.result

  const failures: BuildSkillFailure[] = []
  const messages = await Session.messages({ sessionID: input.sessionID }).catch(() => [])
  const completedTools = new Set<string>()
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      completedTools.add(part.tool)
    }
  }

  const missing = requiredTools.filter((tool) => !completedTools.has(tool))
  if (missing.length > 0) {
    failures.push({
      name: "skill-required tools",
      detail: `Missing completed tool calls: ${missing.join(", ")}`,
    })
  }

  if (requiredTools.includes("webpage_evaluate")) {
    const visualFailure = await verifyWebpageEvaluation(input.worktreeDir)
    if (visualFailure) failures.push(visualFailure)
  }

  if (failures.length === 0) return input.result
  return {
    ...input.result,
    status: "failed",
    summary: "Build rejected by skill-required evidence.",
    tests: [
      ...input.result.tests,
      ...failures.map((failure) => ({
        name: failure.name,
        passed: false,
        detail: failure.detail,
      })),
    ],
    error: failures.map((failure) => `${failure.name}: ${failure.detail}`).join(" | "),
  }
}

async function verifyWebpageEvaluation(worktreeDir: string): Promise<BuildSkillFailure | undefined> {
  const evalPath = path.join(worktreeDir, "mirror", "eval-result.json")
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(await fs.readFile(evalPath, "utf8"))
  } catch (err) {
    return {
      name: "webpage_evaluate result",
      detail: `Missing or unreadable mirror/eval-result.json: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const score = Number(parsed.overallScore)
  if (!Number.isFinite(score)) {
    return { name: "webpage_evaluate score", detail: "mirror/eval-result.json does not contain a numeric overallScore" }
  }
  if (score < 95) {
    return { name: "webpage_evaluate score", detail: `overallScore=${score} is below required target 95` }
  }

  const indexPath = path.join(worktreeDir, "index.html")
  const renderedPathRaw = typeof parsed.renderedPath === "string" ? parsed.renderedPath : "mirror/rendered.png"
  const renderedPath = path.isAbsolute(renderedPathRaw)
    ? renderedPathRaw
    : path.resolve(worktreeDir, renderedPathRaw)
  const [indexStat, renderedStat, evalStat] = await Promise.all([
    fs.stat(indexPath).catch((err) => err),
    fs.stat(renderedPath).catch((err) => err),
    fs.stat(evalPath).catch((err) => err),
  ])
  if (indexStat instanceof Error) {
    return { name: "webpage_render freshness", detail: `Missing index.html: ${indexStat.message}` }
  }
  if (renderedStat instanceof Error) {
    return { name: "webpage_render freshness", detail: `Missing rendered screenshot ${renderedPath}: ${renderedStat.message}` }
  }
  if (evalStat instanceof Error) {
    return { name: "webpage_evaluate freshness", detail: `Missing eval result ${evalPath}: ${evalStat.message}` }
  }
  if (renderedStat.mtimeMs < indexStat.mtimeMs) {
    return {
      name: "webpage_render freshness",
      detail: "mirror/rendered.png is older than index.html; re-run webpage_render after the final edit",
    }
  }
  if (evalStat.mtimeMs < renderedStat.mtimeMs) {
    return {
      name: "webpage_evaluate freshness",
      detail: "mirror/eval-result.json is older than the rendered screenshot; re-run webpage_evaluate after rendering",
    }
  }
  return undefined
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
      "Explore → implement within owned_paths → verify via bash → commit → call StructuredOutput exactly once.",
    )
    return lines.join("\n")
  }
  return [
    "# Request",
    "",
    target.text,
    "",
    "Explore the repo to understand scope, implement the change, verify via bash (tests / build / run), commit, and call StructuredOutput exactly once with your final report.",
  ].join("\n")
}
