/**
 * Group Merge — git 3-way merge from worktree branch to main workspace.
 *
 * Each group executor works in an isolated git worktree branch. When a group completes,
 * its changes are committed to the worktree branch, then merged into the main workspace
 * using `git merge` (3-way merge).
 *
 * Conflict handling: if two groups modify overlapping lines, `git merge` produces a
 * conflict. The merge is aborted and the group hard-fails (no auto-resolve, no fallback).
 */

import { $ } from "bun"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "group-merge" })

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export type MergedFile = {
  file: string
  status: "added" | "modified" | "deleted"
}

export type MergeResult = {
  ok: true
  files: MergedFile[]
} | {
  ok: false
  error: string
}

// ═══════════════════════════════════════════════════════════════════
// Commit Worktree Changes
// ═══════════════════════════════════════════════════════════════════

/**
 * Stage and commit all executor changes in a worktree branch.
 *
 * The executor itself does NOT create commits (the brief instructs it not to).
 * We commit on its behalf so the changes become a proper git ref that can be merged.
 *
 * @returns List of changed files, or empty array if the executor made no changes.
 */
async function commitWorktreeChanges(worktreeDir: string, groupID: string): Promise<MergedFile[]> {
  // Stage all changes (including untracked files)
  const addResult = await $`git add -A`.quiet().nothrow().cwd(worktreeDir)
  if (addResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(addResult.stderr).trim()
    throw new Error(`git add -A failed in worktree ${worktreeDir}: exit ${addResult.exitCode}${stderr ? ` — ${stderr}` : ""}`)
  }

  // Detect what changed (before committing, so we can return early if nothing changed)
  const diffOutput = await $`git diff --cached --name-status --no-renames HEAD`
    .quiet()
    .nothrow()
    .cwd(worktreeDir)
    .text()

  const files: MergedFile[] = []
  for (const line of diffOutput.trim().split("\n")) {
    if (!line.trim()) continue
    const [code, ...rest] = line.split("\t")
    const file = rest.join("\t").trim()
    if (!file) continue
    const status = code?.trim() === "A" ? "added"
      : code?.trim() === "D" ? "deleted"
      : "modified"
    files.push({ file, status })
  }

  if (files.length === 0) return []

  // Commit to the worktree branch
  const commitMsg = `group delivery: ${groupID}`
  const commitResult = await $`git commit --no-gpg-sign -m ${commitMsg}`
    .quiet()
    .nothrow()
    .cwd(worktreeDir)

  if (commitResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(commitResult.stderr).trim()
    throw new Error(`git commit failed in worktree ${worktreeDir}: exit ${commitResult.exitCode}${stderr ? ` — ${stderr}` : ""}`)
  }

  return files
}

// ═══════════════════════════════════════════════════════════════════
// Merge
// ═══════════════════════════════════════════════════════════════════

/**
 * Merge a completed group's worktree branch into the main workspace using git 3-way merge.
 *
 * Flow:
 *   1. Commit all worktree changes to the worktree branch
 *   2. `git merge <worktree-branch> --no-edit` in the main workspace
 *   3. If merge conflict → `git merge --abort` → hard-fail
 *   4. If merge clean → return merged files
 *
 * This is a serialized operation — only one group merges at a time per run
 * (callers must ensure mutual exclusion via the group dispatch loop).
 *
 * Git 3-way merge operates at LINE granularity:
 *   - Two groups modifying DIFFERENT lines in the same file → clean merge
 *   - Two groups modifying the SAME lines → conflict → hard-fail
 *
 * This is strictly more capable than the previous fs.copyFile approach, which
 * treated any same-file overlap as a conflict regardless of line positions.
 */
export async function mergeGroupDelivery(input: {
  runID: string
  groupID: string
  worktreeDir: string
  worktreeBranch: string
}): Promise<MergeResult> {
  const { runID, groupID, worktreeDir, worktreeBranch } = input
  const mainDir = Instance.directory

  // 1. Commit executor's changes to the worktree branch
  let files: MergedFile[]
  try {
    files = await commitWorktreeChanges(worktreeDir, groupID)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("group merge: worktree commit failed", { runID, groupID, error: msg })
    return { ok: false, error: `Failed to commit worktree changes: ${msg}` }
  }

  if (files.length === 0) {
    log.info("group produced no file changes", { runID, groupID })
    return { ok: true, files: [] }
  }

  // 2. Merge the worktree branch into the main workspace (3-way merge)
  const mergeResult = await $`git merge ${worktreeBranch} --no-edit --no-gpg-sign`
    .quiet()
    .nothrow()
    .cwd(mainDir)

  if (mergeResult.exitCode !== 0) {
    const stderr = new TextDecoder().decode(mergeResult.stderr).trim()
    const stdout = new TextDecoder().decode(mergeResult.stdout).trim()

    // Abort the failed merge to restore clean state
    await $`git merge --abort`.quiet().nothrow().cwd(mainDir)

    const detail = stderr || stdout || `exit code ${mergeResult.exitCode}`
    log.error("group merge conflict", { runID, groupID, error: detail })
    return {
      ok: false,
      error: `Git merge failed for group ${groupID}: ${detail}`,
    }
  }

  log.info("group merge complete", {
    runID,
    groupID,
    filesAdded: files.filter((c) => c.status === "added").length,
    filesModified: files.filter((c) => c.status === "modified").length,
    filesDeleted: files.filter((c) => c.status === "deleted").length,
  })

  return { ok: true, files }
}
