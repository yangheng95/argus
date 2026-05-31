/**
 * Shared output-directory resolver for all `webpage_*` tools.
 *
 * Mirror tools produce intermediate evidence artifacts such as reference.png,
 * extracted-page.json, page-ir.xml, scaffold.json, shared-context.md,
 * rendered.png, diff.png, and images/.
 *
 * The default lives in the task runtime:
 *   `<project>/.opencorvus/runtime/tasks/<task>/frontend-design/mirror/`
 * Each task session/worktree gets a `mirror/` view onto that single directory,
 * so downstream agents read one source of truth instead of primary-worktree
 * scratch files.
 *
 * Callers that want a different location, such as benchmark drivers and tests,
 * still override via the tool's outputDir parameter.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { taskIDForSession } from "@/orchestrator/task-event"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { TaskRuntimeMaterializer } from "@/project/task-runtime-materializer"

const MIRROR_SUBDIR = "mirror"

export interface ResolveMirrorOutputDirInput {
  override?: string
  sessionID?: string
}

/**
 * Resolve the effective output directory for a mirror tool.
 *
 * - No override -> task-scoped frontend-design mirror directory.
 * - Override without a session -> explicit benchmark/test directory.
 * - Override inside a task session -> must resolve under `mirror/`.
 *
 * `mkdir -p` is always invoked so tools can immediately write artifacts
 * without each having to repeat the existence check.
 */
export async function resolveMirrorOutputDir(input: ResolveMirrorOutputDirInput = {}): Promise<string> {
  if (input.override) {
    if (input.sessionID) {
      return resolveSessionOverride(input.override, input.sessionID)
    }
    const base = path.isAbsolute(input.override)
      ? input.override
      : path.resolve(Instance.directory, input.override)
    await fs.mkdir(base, { recursive: true })
    return base
  }

  if (!input.sessionID) {
    throw new Error("resolveMirrorOutputDir: default mirror output requires sessionID")
  }

  return resolveSessionDefault(input.sessionID)
}

async function resolveSessionDefault(sessionID: string): Promise<string> {
  const taskID = taskIDForSession(sessionID)
  if (!taskID) {
    throw new Error(`resolveMirrorOutputDir: session ${sessionID} has no owning task`)
  }

  const projectDir = Instance.project.worktree
  await TaskRuntimeMaterializer.materializeFrontendDesign({
    projectDir,
    taskID,
    worktreeDir: Instance.directory,
  })
  const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
  await fs.mkdir(paths.mirrorAbsolute, { recursive: true })
  return paths.mirrorAbsolute
}

async function resolveSessionOverride(override: string, sessionID: string): Promise<string> {
  const mirrorRoot = await resolveSessionDefault(sessionID)
  const viewRoot = path.resolve(Instance.directory, MIRROR_SUBDIR)
  const requested = path.isAbsolute(override)
    ? path.resolve(override)
    : path.resolve(Instance.directory, override)

  if (samePath(requested, viewRoot)) return mirrorRoot
  if (isPathInside(viewRoot, requested)) {
    const target = path.join(mirrorRoot, path.relative(viewRoot, requested))
    await fs.mkdir(target, { recursive: true })
    return target
  }
  if (samePath(requested, mirrorRoot) || isPathInside(mirrorRoot, requested)) {
    await fs.mkdir(requested, { recursive: true })
    return requested
  }

  throw new Error(
    `resolveMirrorOutputDir: task sessions may only write mirror artifacts under ${MIRROR_SUBDIR}/; ` +
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
export const DEFAULT_MIRROR_SUBDIR = MIRROR_SUBDIR
