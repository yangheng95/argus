import path from "node:path"
import { Identifier } from "@/id/id"

type BranchInput = { taskID: string; goalID: string; runID: string } | { taskID: string; sessionID: string }

function safeSegment(input: string): string {
  const value = input
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  if (!value) throw new Error("ProjectRuntimePaths: empty path segment")
  return value
}

function idSegment(input: string): string {
  return safeSegment(Identifier.directoryKey(input))
}

function idFanout(input: string): [string, string] {
  const key = idSegment(input)
  return [key.slice(0, 2), key.slice(2)]
}

function scopedKey(scope: string, input: string): string {
  return safeSegment(Identifier.scopedDirectoryKey(scope, input))
}

function scopedFanout(scope: string, input: string): [string, string] {
  const key = scopedKey(scope, input)
  return [key.slice(0, 2), key.slice(2)]
}

function taskSessionKey(taskID: string, sessionID: string): string {
  return `${taskID}:${sessionID}`
}

function goalRunKey(taskID: string, goalID: string, runID: string): string {
  return `${taskID}:${goalID}:${runID}`
}

export namespace ProjectRuntimePaths {
  export function projectConfigRoot(projectDir: string): string {
    return path.join(projectDir, ".opencorvus")
  }

  export function projectRuntimeRoot(projectDir: string): string {
    return path.join(projectConfigRoot(projectDir), "r")
  }

  export function relativeRuntimeRoot(): string {
    return path.posix.join(".opencorvus", "r")
  }

  export function isInternalRuntimeRelativePath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
    return (
      normalized === ".opencorvus-meta.json" ||
      normalized === ".opencorvus/r" ||
      normalized.startsWith(".opencorvus/r/") ||
      normalized === ".opencorvus/runtime" ||
      normalized.startsWith(".opencorvus/runtime/") ||
      normalized === ".opencorvus/worktrees" ||
      normalized.startsWith(".opencorvus/worktrees/") ||
      normalized === ".opencorvus-worktrees" ||
      normalized.startsWith(".opencorvus-worktrees/")
    )
  }

  export function isSourceEnumerationAllowed(relativePath: string): boolean {
    return !isInternalRuntimeRelativePath(relativePath)
  }

  export function isSourceArchiveAllowed(relativePath: string): boolean {
    return isSourceEnumerationAllowed(relativePath)
  }

  export function isEvidenceInputRelativePath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
    return (
      normalized === "web-clone-source" ||
      normalized.startsWith("web-clone-source/") ||
      normalized === "webpage-evidence" ||
      normalized.startsWith("webpage-evidence/")
    )
  }

  export function taskRoot(projectDir: string, taskID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "t", ...idFanout(taskID))
  }

  export function taskRootFromRuntimeRoot(runtimeRoot: string, taskID: string): string {
    return path.join(runtimeRoot, "t", ...idFanout(taskID))
  }

  export function taskRootReadCandidatesFromRuntimeRoot(runtimeRoot: string, taskID: string): string[] {
    return [taskRootFromRuntimeRoot(runtimeRoot, taskID)]
  }

  export function taskRelative(taskID: string, ...parts: string[]): string {
    return path.posix.join(relativeRuntimeRoot(), "t", ...idFanout(taskID), ...parts)
  }

  export function taskAbsolute(projectDir: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRoot(projectDir, taskID), ...parts)
  }

  export function taskAbsoluteFromRuntimeRoot(runtimeRoot: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRootFromRuntimeRoot(runtimeRoot, taskID), ...parts)
  }

  export function taskAbsoluteReadCandidatesFromRuntimeRoot(
    runtimeRoot: string,
    taskID: string,
    ...parts: string[]
  ): string[] {
    return taskRootReadCandidatesFromRuntimeRoot(runtimeRoot, taskID).map((root) => path.join(root, ...parts))
  }

  export function sessionRoot(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "s", ...scopedFanout("task-session", taskSessionKey(taskID, sessionID)))
  }

  export function sessionRootFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return path.join(runtimeRoot, "s", ...scopedFanout("task-session", taskSessionKey(taskID, sessionID)))
  }

  export function sessionRootReadCandidatesFromRuntimeRoot(
    runtimeRoot: string,
    taskID: string,
    sessionID: string,
  ): string[] {
    return [sessionRootFromRuntimeRoot(runtimeRoot, taskID, sessionID)]
  }

  export function tracePath(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(sessionRoot(projectDir, taskID, sessionID), "trace.jsonl")
  }

  export function tracePathFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return path.join(sessionRootFromRuntimeRoot(runtimeRoot, taskID, sessionID), "trace.jsonl")
  }

  export function tracePathReadCandidatesFromRuntimeRoot(
    runtimeRoot: string,
    taskID: string,
    sessionID: string,
  ): string[] {
    return sessionRootReadCandidatesFromRuntimeRoot(runtimeRoot, taskID, sessionID).map((root) =>
      path.join(root, "trace.jsonl"),
    )
  }

  export function toolOutputDir(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(sessionRoot(projectDir, taskID, sessionID), "tool-output")
  }

  export function sessionTraceIndexPathFromRuntimeRoot(runtimeRoot: string, sessionID: string): string {
    return path.join(runtimeRoot, "sx", ...idFanout(sessionID), "index.json")
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

  export function frontendDesignPaths(
    projectDir: string,
    taskID: string,
  ): {
    relativeDir: string
    absoluteDir: string
    webpageEvidenceRelative: string
    sourcePackageRelative: string
    skeletonProjectRelative: string
    templateRelative: string
    manifestRelative: string
    webpageEvidenceAbsolute: string
    sourcePackageAbsolute: string
    skeletonProjectAbsolute: string
    templateAbsolute: string
    manifestAbsolute: string
  } {
    const webpageEvidenceRelative = taskRelative(taskID, "fd", "webpage-evidence")
    const webpageEvidenceAbsolute = taskAbsolute(projectDir, taskID, "fd", "webpage-evidence")
    return {
      relativeDir: taskRelative(taskID, "fd"),
      absoluteDir: taskAbsolute(projectDir, taskID, "fd"),
      webpageEvidenceRelative,
      sourcePackageRelative: taskRelative(taskID, "fd", "web-clone-source"),
      skeletonProjectRelative: taskRelative(taskID, "fd", "frontend-design-skeleton"),
      templateRelative: taskRelative(taskID, "fd", "frontend-template.md"),
      manifestRelative: taskRelative(taskID, "fd", "evidence-source-manifest.md"),
      webpageEvidenceAbsolute,
      sourcePackageAbsolute: taskAbsolute(projectDir, taskID, "fd", "web-clone-source"),
      skeletonProjectAbsolute: taskAbsolute(projectDir, taskID, "fd", "frontend-design-skeleton"),
      templateAbsolute: taskAbsolute(projectDir, taskID, "fd", "frontend-template.md"),
      manifestAbsolute: taskAbsolute(projectDir, taskID, "fd", "evidence-source-manifest.md"),
    }
  }

  export function deepResearchPaths(
    projectDir: string,
    taskID: string,
    sessionID: string,
  ): {
    relativeDir: string
    absoluteDir: string
    fullMarkdownAbsolute: string
    evidenceJsonAbsolute: string
    citationMapAbsolute: string
  } {
    const relativeDir = taskRelative(taskID, "dr", ...idFanout(sessionID))
    const absoluteDir = taskAbsolute(projectDir, taskID, "dr", ...idFanout(sessionID))
    return {
      relativeDir,
      absoluteDir,
      fullMarkdownAbsolute: path.join(absoluteDir, "research-bundle.md"),
      evidenceJsonAbsolute: path.join(absoluteDir, "evidence.json"),
      citationMapAbsolute: path.join(absoluteDir, "citation-map.json"),
    }
  }

  export function frontendResearchPaths(
    projectDir: string,
    taskID: string,
    sessionID: string,
  ): {
    relativeDir: string
    absoluteDir: string
    fullMarkdownAbsolute: string
    evidenceJsonAbsolute: string
    citationMapAbsolute: string
  } {
    const relativeDir = taskRelative(taskID, "fr", ...idFanout(sessionID))
    const absoluteDir = taskAbsolute(projectDir, taskID, "fr", ...idFanout(sessionID))
    return {
      relativeDir,
      absoluteDir,
      fullMarkdownAbsolute: path.join(absoluteDir, "research-bundle.md"),
      evidenceJsonAbsolute: path.join(absoluteDir, "evidence.json"),
      citationMapAbsolute: path.join(absoluteDir, "citation-map.json"),
    }
  }

  export function acceptancePaths(
    projectDir: string,
    taskID: string,
  ): {
    root: string
    screenshots: string
    checkWorkspaces: string
  } {
    const root = taskAbsolute(projectDir, taskID, "a")
    return {
      root,
      screenshots: path.join(root, "screenshots"),
      checkWorkspaces: path.join(root, "check-workspaces"),
    }
  }

  export function browserPreviewJobRoot(projectDir: string, taskID: string, jobID: string): string {
    return taskAbsolute(projectDir, taskID, "bp", ...idFanout(jobID))
  }

  export function browserPreviewJobRelative(taskID: string, jobID: string, ...parts: string[]): string {
    return taskRelative(taskID, "bp", ...idFanout(jobID), ...parts)
  }

  export function tasklessAcceptancePaths(projectDir: string): {
    root: string
    checkWorkspaces: string
  } {
    const root = path.join(projectRuntimeRoot(projectDir), "a", "no-task")
    return {
      root,
      checkWorkspaces: path.join(root, "check-workspaces"),
    }
  }

  export function docsRoot(projectDir: string, taskID: string): string {
    return taskAbsolute(projectDir, taskID, "docs")
  }

  export function docsPaths(
    projectDir: string,
    taskID: string,
  ): Record<"prds" | "plans" | "goals" | "evaluations", string> {
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

  export function missionRoot(projectDir: string, missionID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "m", ...scopedFanout("mission", missionID))
  }

  export function attachmentBlobRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "b", "a")
  }

  export function snapshotCacheRoot(projectDir: string, projectID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "c", "snap", safeSegment(projectID))
  }

  export function sessionDiffRoot(projectDir: string, projectID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "c", "sdiff", safeSegment(projectID))
  }

  export function sessionDiffPath(projectDir: string, projectID: string, sessionID: string): string {
    return path.join(sessionDiffRoot(projectDir, projectID), `${idSegment(sessionID)}.json`)
  }

  export function sessionDiffPathReadCandidates(projectDir: string, projectID: string, sessionID: string): string[] {
    return [sessionDiffPath(projectDir, projectID, sessionID)]
  }

  export function worktreesRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "w")
  }

  export function worktreeDir(projectDir: string, taskID: string, goalID: string, runID: string): string {
    return path.join(worktreesRoot(projectDir), ...scopedFanout("goal-run", goalRunKey(taskID, goalID, runID)), "worktree")
  }

  export function directBuildWorktreeDir(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(
      worktreesRoot(projectDir),
      ...scopedFanout("task-session", taskSessionKey(taskID, sessionID)),
      "worktree",
    )
  }

  export function worktreeBranch(input: BranchInput): string {
    if ("goalID" in input) {
      return `opencorvus/w/${scopedKey("goal-run", goalRunKey(input.taskID, input.goalID, input.runID))}`
    }
    return `opencorvus/s/${scopedKey("task-session", taskSessionKey(input.taskID, input.sessionID))}`
  }

  export function ownershipRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "o")
  }

  export function ownershipPaths(
    projectDir: string,
    taskID: string,
    sessionID: string,
    goalRunID?: string,
  ): {
    worktreeMarkerDir: string
    processMarkerDir: string
    worktreeMarkerName: string
    processMarkerPrefix: string
  } {
    const task = idSegment(taskID)
    const session = idSegment(sessionID)
    const goal = goalRunID ? `-${idSegment(goalRunID)}` : ""
    return {
      worktreeMarkerDir: path.join(ownershipRoot(projectDir), "w", ...idFanout(taskID)),
      processMarkerDir: path.join(ownershipRoot(projectDir), "p", ...idFanout(taskID)),
      worktreeMarkerName: `${session}${goal}.json`,
      processMarkerPrefix: `${session}-`,
    }
  }

  export function projectGitLock(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "l", "project-git.lock")
  }

  export const legacyRuntimeRelativePaths = [
    path.posix.join(".opencorvus", "runtime"),
    path.posix.join(".opencorvus", "intent"),
    path.posix.join(".opencorvus", "frontend-design"),
    path.posix.join(".opencorvus", "decision-log.md"),
    path.posix.join(".opencorvus", "worktrees"),
    path.posix.join(".opencorvus", "ownership"),
    path.posix.join(".opencorvus", "trace"),
  ] as const
}
