import path from "node:path"

type BranchInput =
  | { taskID: string; goalID: string; runID: string }
  | { taskID: string; sessionID: string }

function safeSegment(input: string): string {
  const value = input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!value) throw new Error("ProjectRuntimePaths: empty path segment")
  return value
}

function short(input: string): string {
  return safeSegment(input).slice(0, 16)
}

export namespace ProjectRuntimePaths {
  export function projectConfigRoot(projectDir: string): string {
    return path.join(projectDir, ".opencorvus")
  }

  export function projectRuntimeRoot(projectDir: string): string {
    return path.join(projectConfigRoot(projectDir), "runtime")
  }

  export function relativeRuntimeRoot(): string {
    return path.posix.join(".opencorvus", "runtime")
  }

  export function taskRoot(projectDir: string, taskID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "tasks", safeSegment(taskID))
  }

  export function taskRootFromRuntimeRoot(runtimeRoot: string, taskID: string): string {
    return path.join(runtimeRoot, "tasks", safeSegment(taskID))
  }

  export function taskRelative(taskID: string, ...parts: string[]): string {
    return path.posix.join(relativeRuntimeRoot(), "tasks", safeSegment(taskID), ...parts)
  }

  export function taskAbsolute(projectDir: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRoot(projectDir, taskID), ...parts)
  }

  export function taskAbsoluteFromRuntimeRoot(runtimeRoot: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRootFromRuntimeRoot(runtimeRoot, taskID), ...parts)
  }

  export function sessionRoot(projectDir: string, taskID: string, sessionID: string): string {
    return taskAbsolute(projectDir, taskID, "sessions", safeSegment(sessionID))
  }

  export function sessionRootFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return taskAbsoluteFromRuntimeRoot(runtimeRoot, taskID, "sessions", safeSegment(sessionID))
  }

  export function tracePath(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(sessionRoot(projectDir, taskID, sessionID), "trace.jsonl")
  }

  export function tracePathFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return path.join(sessionRootFromRuntimeRoot(runtimeRoot, taskID, sessionID), "trace.jsonl")
  }

  export function toolOutputDir(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(sessionRoot(projectDir, taskID, sessionID), "tool-output")
  }

  export function intentPaths(projectDir: string, taskID: string): { relative: string; absolute: string } {
    return {
      relative: taskRelative(taskID, "intent", "request.md"),
      absolute: taskAbsolute(projectDir, taskID, "intent", "request.md"),
    }
  }

  export function decisionLogPaths(projectDir: string, taskID: string): { relative: string; absolute: string } {
    return {
      relative: taskRelative(taskID, "decision-log.md"),
      absolute: taskAbsolute(projectDir, taskID, "decision-log.md"),
    }
  }

  export function designAnalysisPaths(projectDir: string, taskID: string): {
    relativeDir: string
    mirrorRelative: string
    prdRelative: string
    manifestRelative: string
    mirrorAbsolute: string
    prdAbsolute: string
    manifestAbsolute: string
  } {
    return {
      relativeDir: taskRelative(taskID, "design-analysis"),
      mirrorRelative: taskRelative(taskID, "design-analysis", "mirror"),
      prdRelative: taskRelative(taskID, "design-analysis", "prd-spec.md"),
      manifestRelative: taskRelative(taskID, "design-analysis", "evidence-source-manifest.md"),
      mirrorAbsolute: taskAbsolute(projectDir, taskID, "design-analysis", "mirror"),
      prdAbsolute: taskAbsolute(projectDir, taskID, "design-analysis", "prd-spec.md"),
      manifestAbsolute: taskAbsolute(projectDir, taskID, "design-analysis", "evidence-source-manifest.md"),
    }
  }

  export function deliveryPaths(projectDir: string, taskID: string): {
    root: string
    screenshots: string
    checkWorkspaces: string
  } {
    const root = taskAbsolute(projectDir, taskID, "delivery")
    return {
      root,
      screenshots: path.join(root, "screenshots"),
      checkWorkspaces: path.join(root, "check-workspaces"),
    }
  }

  export function tasklessDeliveryPaths(projectDir: string): {
    root: string
    checkWorkspaces: string
  } {
    const root = path.join(projectRuntimeRoot(projectDir), "delivery", "no-task")
    return {
      root,
      checkWorkspaces: path.join(root, "check-workspaces"),
    }
  }

  export function docsRoot(projectDir: string, taskID: string): string {
    return taskAbsolute(projectDir, taskID, "docs")
  }

  export function docsPaths(projectDir: string, taskID: string): Record<"prds" | "plans" | "goals" | "evaluations", string> {
    const root = docsRoot(projectDir, taskID)
    return {
      prds: path.join(root, "prds"),
      plans: path.join(root, "plans"),
      goals: path.join(root, "goals"),
      evaluations: path.join(root, "evaluations"),
    }
  }

  export function eventLogPath(projectDir: string, taskID: string): { ndjson: string; timeline: string } {
    const dir = taskAbsolute(projectDir, taskID, "logs")
    return {
      ndjson: path.join(dir, "events.ndjson"),
      timeline: path.join(dir, "timeline.log"),
    }
  }

  export function attachmentBlobRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "blobs", "attachments")
  }

  export function snapshotCacheRoot(projectDir: string, projectID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "cache", "snapshot", safeSegment(projectID))
  }

  export function sessionDiffRoot(projectDir: string, projectID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "cache", "session_diff", safeSegment(projectID))
  }

  export function sessionDiffPath(projectDir: string, projectID: string, sessionID: string): string {
    return path.join(sessionDiffRoot(projectDir, projectID), `${safeSegment(sessionID)}.json`)
  }

  export function worktreesRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "worktrees")
  }

  export function worktreeDir(projectDir: string, taskID: string, goalID: string, runID: string): string {
    return taskAbsolute(projectDir, taskID, "goals", safeSegment(goalID), "runs", safeSegment(runID), "worktree")
  }

  export function directBuildWorktreeDir(projectDir: string, taskID: string, sessionID: string): string {
    return taskAbsolute(projectDir, taskID, "sessions", safeSegment(sessionID), "worktree")
  }

  export function worktreeBranch(input: BranchInput): string {
    if ("goalID" in input) {
      return `opencorvus/task/${short(input.taskID)}/goal/${short(input.goalID)}/run/${short(input.runID)}`
    }
    return `opencorvus/task/${short(input.taskID)}/session/${short(input.sessionID)}`
  }

  export function ownershipRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "ownership")
  }

  export function ownershipPaths(projectDir: string, taskID: string, sessionID: string, goalRunID?: string): {
    worktreeMarkerDir: string
    processMarkerDir: string
    worktreeMarkerName: string
    processMarkerPrefix: string
  } {
    const task = safeSegment(taskID)
    const session = safeSegment(sessionID)
    const goal = goalRunID ? `-${safeSegment(goalRunID)}` : ""
    return {
      worktreeMarkerDir: path.join(ownershipRoot(projectDir), "worktrees", task),
      processMarkerDir: path.join(ownershipRoot(projectDir), "processes", task),
      worktreeMarkerName: `${session}${goal}.json`,
      processMarkerPrefix: `${session}-`,
    }
  }

  export function projectGitLock(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "locks", "project-git.lock")
  }

  export const legacyRuntimeRelativePaths = [
    path.posix.join(".opencorvus", "intent"),
    path.posix.join(".opencorvus", "design-analysis"),
    path.posix.join(".opencorvus", "decision-log.md"),
    path.posix.join(".opencorvus", "worktrees"),
    path.posix.join(".opencorvus", "ownership"),
    path.posix.join(".opencorvus", "trace"),
  ] as const
}
