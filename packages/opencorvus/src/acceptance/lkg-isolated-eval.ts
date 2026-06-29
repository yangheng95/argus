import fs from "node:fs/promises"
import path from "node:path"
import { EngineGit, type LKGOutcome } from "@/engine/git"
import type { TaskRow } from "@/engine/store"
import { Instance } from "@/project/instance"
import { AttachmentStore } from "@/storage/attachment-store"
import { git } from "@/util/git"
import { Log } from "@/util/log"
import { Worktree } from "@/worktree"
import { computeVisualMetric, loadVisualThresholds, type VisualMetricResult } from "./visual-metric"

const log = Log.create({ service: "acceptance-lkg-isolated-eval" })

export type IsolatedLKGResult = {
  outcome: LKGOutcome
  metric: VisualMetricResult
  evaluatedSha: string
  renderedArtifactPath: string
}

/**
 * Evaluate acceptance LKG inside a detached temporary git worktree.
 *
 * Contract: the eval tree is checked out at `roundCommitSha`, so only committed
 * state participates in rollback. Uncommitted primary-worktree edits are not
 * visible here by design. The rendered/reference PNGs are resolved from the
 * attachment store URLs supplied by the caller; git rollback, if any, is scoped
 * to the temporary worktree and never mutates `Instance.directory`.
 */
export async function evaluateLKGInIsolatedWorktree(input: {
  task: TaskRow
  iteration: number
  roundCommitSha: string
  renderedRefUrl: string
  referenceRefUrl: string
}): Promise<IsolatedLKGResult> {
  const primaryDir = Instance.worktree
  const evalDir = path.join(
    primaryDir,
    ".opencorvus",
    "acceptance-eval",
    `${safePathPart(input.task.id)}-${input.iteration}-${safePathPart(input.roundCommitSha).slice(0, 12)}`,
  )
  let created = false

  try {
    await fs.mkdir(path.dirname(evalDir), { recursive: true })
    const added = await Worktree.withGitLock(() =>
      git(["worktree", "add", "--detach", evalDir, input.roundCommitSha], {
        cwd: primaryDir,
        timeoutProfile: "default",
      }),
    )
    if (added.exitCode !== 0) {
      throw new Error(`evaluateLKGInIsolatedWorktree: git worktree add failed: ${gitError(added)}`)
    }
    created = true

    const head = await git(["rev-parse", "HEAD"], { cwd: evalDir, timeoutProfile: "fast" })
    if (head.exitCode !== 0) {
      throw new Error(`evaluateLKGInIsolatedWorktree: rev-parse HEAD failed: ${gitError(head)}`)
    }
    const evaluatedSha = head.text().trim()
    if (!evaluatedSha) throw new Error("evaluateLKGInIsolatedWorktree: eval worktree HEAD is empty")

    const renderedPath = resolveAttachmentPath(input.renderedRefUrl, "rendered")
    const referencePath = resolveAttachmentPath(input.referenceRefUrl, "reference")
    const metric = await computeVisualMetric({
      renderedPath,
      referencePath,
      thresholds: loadVisualThresholds(),
    })
    const lkg = await EngineGit.evaluateAndApplyLKG({
      task: input.task,
      iteration: input.iteration,
      score: metric.score,
      roundCommitSha: evaluatedSha,
      worktreeDirectory: evalDir,
    })

    return {
      outcome: lkg.outcome,
      metric,
      evaluatedSha,
      renderedArtifactPath: renderedPath,
    }
  } finally {
    if (created) {
      await removeEvalWorktree(evalDir)
      log.info("removed isolated acceptance LKG worktree", {
        taskID: input.task.id,
        iteration: input.iteration,
        directory: evalDir,
      })
    }
  }
}

function resolveAttachmentPath(url: string, label: "rendered" | "reference"): string {
  const loc = AttachmentStore.nameFromUrl(url)
  if (!loc) throw new Error(`evaluateLKGInIsolatedWorktree: ${label} attachment URL is not resolvable: ${url}`)
  const resolved = AttachmentStore.resolveAbsolute(loc.projectID, loc.name)
  if (!resolved) {
    throw new Error(`evaluateLKGInIsolatedWorktree: ${label} attachment is missing from store: ${url}`)
  }
  return resolved
}

async function removeEvalWorktree(evalDir: string): Promise<void> {
  try {
    await Worktree.remove({ directory: evalDir })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`evaluateLKGInIsolatedWorktree: remove eval worktree failed: ${message}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

function safePathPart(value: string): string {
  const slug = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!slug) throw new Error("evaluateLKGInIsolatedWorktree: empty path component")
  return slug
}

function gitError(result: { stdout?: Buffer; stderr?: Buffer }): string {
  return [result.stderr?.toString().trim(), result.stdout?.toString().trim()].filter(Boolean).join("\n") || "git failed"
}
