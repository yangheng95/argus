import fs from "node:fs/promises"
import path from "node:path"

import { ProjectRuntimePaths } from "@/project/runtime-paths"

const MIRROR_VIEW_NAME = "mirror"
const EXCLUDE_MARKER = "# OpenCorvus task runtime views"

export namespace TaskRuntimeMaterializer {
  export async function mirrorDir(projectDir: string, taskID: string): Promise<string> {
    const paths = ProjectRuntimePaths.designAnalysisPaths(projectDir, taskID)
    await fs.mkdir(paths.mirrorAbsolute, { recursive: true })
    return paths.mirrorAbsolute
  }

  export async function materializeDesignAnalysis(input: {
    projectDir: string
    taskID: string
    worktreeDir: string
  }): Promise<void> {
    const paths = ProjectRuntimePaths.designAnalysisPaths(input.projectDir, input.taskID)
    await fs.mkdir(paths.mirrorAbsolute, { recursive: true })

    const designView = path.join(input.worktreeDir, paths.relativeDir)
    if (!sameResolvedPath(designView, path.dirname(paths.mirrorAbsolute))) {
      await ensureDirectoryLink({
        linkPath: designView,
        targetPath: path.dirname(paths.mirrorAbsolute),
      })
    }

    await ensureMirrorViewIgnored(input.projectDir)
    await ensureDirectoryLink({
      linkPath: path.join(input.worktreeDir, MIRROR_VIEW_NAME),
      targetPath: paths.mirrorAbsolute,
    })
  }
}

async function ensureDirectoryLink(input: { linkPath: string; targetPath: string }): Promise<void> {
  await fs.mkdir(input.targetPath, { recursive: true })

  const existingTarget = await readLinkTarget(input.linkPath)
  if (existingTarget) {
    if (await sameRealPath(existingTarget, input.targetPath)) return
    throw new Error(
      `TaskRuntimeMaterializer: refusing to replace existing runtime view ${input.linkPath}; ` +
      `it points at ${existingTarget}, expected ${input.targetPath}`,
    )
  }

  const existing = await fs.lstat(input.linkPath).catch(() => undefined)
  if (existing) {
    throw new Error(
      `TaskRuntimeMaterializer: refusing to replace existing non-link path ${input.linkPath}; ` +
      `remove it before materializing task runtime artifacts`,
    )
  }

  await fs.mkdir(path.dirname(input.linkPath), { recursive: true })
  try {
    await fs.symlink(input.targetPath, input.linkPath, process.platform === "win32" ? "junction" : "dir")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const racedTarget = await readLinkTarget(input.linkPath)
      if (racedTarget && await sameRealPath(racedTarget, input.targetPath)) return
    }
    throw error
  }
}

async function readLinkTarget(linkPath: string): Promise<string | undefined> {
  try {
    const target = await fs.readlink(linkPath)
    return path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    if ((error as NodeJS.ErrnoException).code === "EINVAL") return undefined
    throw error
  }
}

async function sameRealPath(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([realOrResolved(a), realOrResolved(b)])
  return key(left) === key(right)
}

function sameResolvedPath(a: string, b: string): boolean {
  return key(path.resolve(a)) === key(path.resolve(b))
}

async function realOrResolved(input: string): Promise<string> {
  return fs.realpath(input).catch(() => path.resolve(input))
}

function key(input: string): string {
  const normalized = path.normalize(input)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

async function ensureMirrorViewIgnored(projectDir: string): Promise<void> {
  const excludePath = path.join(projectDir, ".git", "info", "exclude")
  await fs.mkdir(path.dirname(excludePath), { recursive: true })
  const existing = await fs.readFile(excludePath, "utf8").catch(() => "")
  const lines = existing.split(/\r?\n/).map((line) => line.trim())
  const entries = [`/${MIRROR_VIEW_NAME}`, `/${MIRROR_VIEW_NAME}/`].filter((line) => !lines.includes(line))
  if (entries.length === 0) return
  const prefix = existing.trimEnd()
  const next = [
    prefix,
    EXCLUDE_MARKER,
    ...entries,
    "",
  ].filter((line, index) => index !== 0 || line.length > 0).join("\n")
  await fs.writeFile(excludePath, `${next}\n`, "utf8")
}
