/**
 * Shared output-directory resolver for all `webpage_*` tools.
 *
 * Webpage evidence tools produce intermediate evidence artifacts such as
 * reference.png, extracted-page.json, page.ir.json, assets/manifest.json,
 * rendered.png, diff.png, source-skeleton/, and source-ir/.
 *
 * The default lives in the task runtime:
 *   `<project>/.opencorvus/r/t/<task-key>/fd/webpage-evidence/`
 * Callers that want a different location, such as benchmark drivers and tests,
 * still override via the tool's outputDir parameter.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { taskIDForSession } from "@/orchestrator/task-event"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { TaskRuntimeMaterializer } from "@/project/task-runtime-materializer"

const WEBPAGE_EVIDENCE_SUBDIR = "webpage-evidence"

export interface ResolveWebpageEvidenceOutputDirInput {
  override?: string
  sessionID?: string
}

/**
 * Resolve the effective output directory for a webpage evidence tool.
 *
 * - No override -> task-scoped frontend-design webpage evidence directory.
 * - Override without a session -> explicit benchmark/test directory.
 * - Override inside a task session -> must resolve under `webpage-evidence/`.
 *
 * `mkdir -p` is always invoked so tools can immediately write artifacts
 * without each having to repeat the existence check.
 */
export async function resolveWebpageEvidenceOutputDir(
  input: ResolveWebpageEvidenceOutputDirInput = {},
): Promise<string> {
  if (input.override) {
    if (input.sessionID) {
      return resolveSessionOverride(input.override, input.sessionID)
    }
    const base = path.isAbsolute(input.override) ? input.override : path.resolve(Instance.directory, input.override)
    await fs.mkdir(base, { recursive: true })
    return base
  }

  if (!input.sessionID) {
    throw new Error("resolveWebpageEvidenceOutputDir: default webpage evidence output requires sessionID")
  }

  return resolveSessionDefault(input.sessionID)
}

async function resolveSessionDefault(sessionID: string): Promise<string> {
  const taskID = taskIDForSession(sessionID)
  if (!taskID) {
    throw new Error(`resolveWebpageEvidenceOutputDir: session ${sessionID} has no owning task`)
  }

  const projectDir = Instance.project.worktree
  await TaskRuntimeMaterializer.materializeFrontendDesign({
    projectDir,
    taskID,
    worktreeDir: Instance.directory,
  })
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
  await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
  return paths.webpageEvidenceAbsolute
}

async function resolveSessionOverride(override: string, sessionID: string): Promise<string> {
  const evidenceRoot = await resolveSessionDefault(sessionID)
  const viewRoot = path.resolve(Instance.directory, WEBPAGE_EVIDENCE_SUBDIR)
  const requested = path.isAbsolute(override) ? path.resolve(override) : path.resolve(Instance.directory, override)

  if (samePath(requested, viewRoot)) return evidenceRoot
  if (isPathInside(viewRoot, requested)) {
    const target = path.join(evidenceRoot, path.relative(viewRoot, requested))
    await fs.mkdir(target, { recursive: true })
    return target
  }
  if (samePath(requested, evidenceRoot) || isPathInside(evidenceRoot, requested)) {
    await fs.mkdir(requested, { recursive: true })
    return requested
  }

  throw new Error(
    `resolveWebpageEvidenceOutputDir: task sessions may only write webpage evidence artifacts under ${WEBPAGE_EVIDENCE_SUBDIR}/; ` +
      `refusing outputDir=${override}`,
  )
}

function samePath(a: string, b: string): boolean {
  return pathKey(a) === pathKey(b)
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative)
}

function pathKey(input: string): string {
  const normalized = path.normalize(input)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

/** The path segment used when no override is supplied. Exposed for docstrings
 *  and tool-description text that needs to name the convention. */
export const DEFAULT_WEBPAGE_EVIDENCE_SUBDIR = WEBPAGE_EVIDENCE_SUBDIR
