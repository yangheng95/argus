import path from "node:path"
import { Identifier } from "@/id/id"

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

function idSegment(input: string): string {
  return safeSegment(Identifier.shortPath(input))
}

function legacyIDSegment(input: string): string {
  return safeSegment(input)
}

function unique(items: string[]): string[] {
  return [...new Set(items)]
}

function idSegmentCandidates(input: string): string[] {
  return unique([idSegment(input), safeSegment(Identifier.legacyShortPath(input)), legacyIDSegment(input)])
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

  export function isInternalRuntimeRelativePath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "")
    return (
      normalized === ".opencorvus-meta.json" ||
      normalized.startsWith(".opencorvus/runtime/") ||
      normalized.startsWith(".opencorvus/worktrees/") ||
      normalized.startsWith(".opencorvus-worktrees/")
    )
  }

  export function isEvidenceInputRelativePath(input: string): boolean {
    const normalized = input.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "")
    return (
      normalized === "web-clone-source" ||
      normalized.startsWith("web-clone-source/") ||
      normalized === "webpage-evidence" ||
      normalized.startsWith("webpage-evidence/") ||
      normalized === "mirror" ||
      normalized.startsWith("mirror/")
    )
  }

  export function taskRoot(projectDir: string, taskID: string): string {
    return path.join(projectRuntimeRoot(projectDir), "tasks", idSegment(taskID))
  }

  export function taskRootFromRuntimeRoot(runtimeRoot: string, taskID: string): string {
    return path.join(runtimeRoot, "tasks", idSegment(taskID))
  }

  export function taskRootReadCandidatesFromRuntimeRoot(runtimeRoot: string, taskID: string): string[] {
    return idSegmentCandidates(taskID).map((segment) => path.join(runtimeRoot, "tasks", segment))
  }

  export function taskRelative(taskID: string, ...parts: string[]): string {
    return path.posix.join(relativeRuntimeRoot(), "tasks", idSegment(taskID), ...parts)
  }

  export function taskAbsolute(projectDir: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRoot(projectDir, taskID), ...parts)
  }

  export function taskAbsoluteFromRuntimeRoot(runtimeRoot: string, taskID: string, ...parts: string[]): string {
    return path.join(taskRootFromRuntimeRoot(runtimeRoot, taskID), ...parts)
  }

  export function taskAbsoluteReadCandidatesFromRuntimeRoot(runtimeRoot: string, taskID: string, ...parts: string[]): string[] {
    return taskRootReadCandidatesFromRuntimeRoot(runtimeRoot, taskID).map((root) => path.join(root, ...parts))
  }

  export function sessionRoot(projectDir: string, taskID: string, sessionID: string): string {
    return taskAbsolute(projectDir, taskID, "sessions", idSegment(sessionID))
  }

  export function sessionRootFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return taskAbsoluteFromRuntimeRoot(runtimeRoot, taskID, "sessions", idSegment(sessionID))
  }

  export function sessionRootReadCandidatesFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string[] {
    return taskRootReadCandidatesFromRuntimeRoot(runtimeRoot, taskID).flatMap((taskRoot) =>
      idSegmentCandidates(sessionID).map((sessionSegment) => path.join(taskRoot, "sessions", sessionSegment)),
    )
  }

  export function tracePath(projectDir: string, taskID: string, sessionID: string): string {
    return path.join(sessionRoot(projectDir, taskID, sessionID), "trace.jsonl")
  }

  export function tracePathFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string {
    return path.join(sessionRootFromRuntimeRoot(runtimeRoot, taskID, sessionID), "trace.jsonl")
  }

  export function tracePathReadCandidatesFromRuntimeRoot(runtimeRoot: string, taskID: string, sessionID: string): string[] {
    return sessionRootReadCandidatesFromRuntimeRoot(runtimeRoot, taskID, sessionID).map((root) =>
      path.join(root, "trace.jsonl"),
    )
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

  export function frontendDesignPaths(projectDir: string, taskID: string): {
    relativeDir: string
    webpageEvidenceRelative: string
    legacyMirrorRelative: string
    /** @deprecated Use webpageEvidenceRelative. Legacy name retained for old callers during mirror dissolution. */
    mirrorRelative: string
    sourcePackageRelative: string
    skeletonProjectRelative: string
    templateRelative: string
    manifestRelative: string
    webpageEvidenceAbsolute: string
    legacyMirrorAbsolute: string
    /** @deprecated Use webpageEvidenceAbsolute. Legacy name retained for old callers during mirror dissolution. */
    mirrorAbsolute: string
    sourcePackageAbsolute: string
    skeletonProjectAbsolute: string
    templateAbsolute: string
    manifestAbsolute: string
  } {
    const webpageEvidenceRelative = taskRelative(taskID, "frontend-design", "webpage-evidence")
    const webpageEvidenceAbsolute = taskAbsolute(projectDir, taskID, "frontend-design", "webpage-evidence")
    const legacyMirrorRelative = taskRelative(taskID, "frontend-design", "mirror")
    const legacyMirrorAbsolute = taskAbsolute(projectDir, taskID, "frontend-design", "mirror")
    return {
      relativeDir: taskRelative(taskID, "frontend-design"),
      webpageEvidenceRelative,
      legacyMirrorRelative,
      mirrorRelative: webpageEvidenceRelative,
      sourcePackageRelative: taskRelative(taskID, "frontend-design", "web-clone-source"),
      skeletonProjectRelative: taskRelative(taskID, "frontend-design", "frontend-design-skeleton"),
      templateRelative: taskRelative(taskID, "frontend-design", "frontend-template.md"),
      manifestRelative: taskRelative(taskID, "frontend-design", "evidence-source-manifest.md"),
      webpageEvidenceAbsolute,
      legacyMirrorAbsolute,
      mirrorAbsolute: webpageEvidenceAbsolute,
      sourcePackageAbsolute: taskAbsolute(projectDir, taskID, "frontend-design", "web-clone-source"),
      skeletonProjectAbsolute: taskAbsolute(projectDir, taskID, "frontend-design", "frontend-design-skeleton"),
      templateAbsolute: taskAbsolute(projectDir, taskID, "frontend-design", "frontend-template.md"),
      manifestAbsolute: taskAbsolute(projectDir, taskID, "frontend-design", "evidence-source-manifest.md"),
    }
  }

  export function researchPaths(projectDir: string, taskID: string, sessionID: string): {
    relativeDir: string
    absoluteDir: string
    fullMarkdownAbsolute: string
    evidenceJsonAbsolute: string
    citationMapAbsolute: string
  } {
    const relativeDir = taskRelative(taskID, "research", idSegment(sessionID))
    const absoluteDir = taskAbsolute(projectDir, taskID, "research", idSegment(sessionID))
    return {
      relativeDir,
      absoluteDir,
      fullMarkdownAbsolute: path.join(absoluteDir, "research-bundle.md"),
      evidenceJsonAbsolute: path.join(absoluteDir, "evidence.json"),
      citationMapAbsolute: path.join(absoluteDir, "citation-map.json"),
    }
  }

  export function frontendResearchPaths(projectDir: string, taskID: string, sessionID: string): {
    relativeDir: string
    absoluteDir: string
    fullMarkdownAbsolute: string
    evidenceJsonAbsolute: string
    citationMapAbsolute: string
  } {
    const relativeDir = taskRelative(taskID, "frontend-research", idSegment(sessionID))
    const absoluteDir = taskAbsolute(projectDir, taskID, "frontend-research", idSegment(sessionID))
    return {
      relativeDir,
      absoluteDir,
      fullMarkdownAbsolute: path.join(absoluteDir, "research-bundle.md"),
      evidenceJsonAbsolute: path.join(absoluteDir, "evidence.json"),
      citationMapAbsolute: path.join(absoluteDir, "citation-map.json"),
    }
  }

  export function acceptancePaths(projectDir: string, taskID: string): {
    root: string
    screenshots: string
    checkWorkspaces: string
  } {
    const root = taskAbsolute(projectDir, taskID, "acceptance")
    return {
      root,
      screenshots: path.join(root, "screenshots"),
      checkWorkspaces: path.join(root, "check-workspaces"),
    }
  }

  export function tasklessAcceptancePaths(projectDir: string): {
    root: string
    checkWorkspaces: string
  } {
    const root = path.join(projectRuntimeRoot(projectDir), "acceptance", "no-task")
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
    return path.join(sessionDiffRoot(projectDir, projectID), `${idSegment(sessionID)}.json`)
  }

  export function sessionDiffPathReadCandidates(projectDir: string, projectID: string, sessionID: string): string[] {
    return idSegmentCandidates(sessionID).map((segment) => path.join(sessionDiffRoot(projectDir, projectID), `${segment}.json`))
  }

  export function worktreesRoot(projectDir: string): string {
    return path.join(projectRuntimeRoot(projectDir), "worktrees")
  }

  export function worktreeDir(projectDir: string, taskID: string, goalID: string, runID: string): string {
    return taskAbsolute(projectDir, taskID, "goals", idSegment(goalID), "runs", idSegment(runID), "worktree")
  }

  export function directBuildWorktreeDir(projectDir: string, taskID: string, sessionID: string): string {
    return taskAbsolute(projectDir, taskID, "sessions", idSegment(sessionID), "worktree")
  }

  export function worktreeBranch(input: BranchInput): string {
    if ("goalID" in input) {
      return `opencorvus/task/${idSegment(input.taskID)}/goal/${idSegment(input.goalID)}/run/${idSegment(input.runID)}`
    }
    return `opencorvus/task/${idSegment(input.taskID)}/session/${idSegment(input.sessionID)}`
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
    const task = idSegment(taskID)
    const session = idSegment(sessionID)
    const goal = goalRunID ? `-${idSegment(goalRunID)}` : ""
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
    path.posix.join(".opencorvus", "frontend-design"),
    path.posix.join(".opencorvus", "decision-log.md"),
    path.posix.join(".opencorvus", "worktrees"),
    path.posix.join(".opencorvus", "ownership"),
    path.posix.join(".opencorvus", "trace"),
  ] as const
}
