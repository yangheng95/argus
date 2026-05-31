import fs from "node:fs/promises"
import path from "node:path"

import { ProjectRuntimePaths } from "@/project/runtime-paths"

const MIRROR_VIEW_NAME = "mirror"
const SOURCE_PACKAGE_VIEW_NAME = "web-clone-source"
const EXCLUDE_MARKER = "# OpenCorvus task runtime views"

export namespace TaskRuntimeMaterializer {
  export async function mirrorDir(projectDir: string, taskID: string): Promise<string> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
    await fs.mkdir(paths.mirrorAbsolute, { recursive: true })
    return paths.mirrorAbsolute
  }

  export async function materializeFrontendDesign(input: {
    projectDir: string
    taskID: string
    worktreeDir: string
  }): Promise<void> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
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
      replaceExistingLinkTargetRoot: ProjectRuntimePaths.projectRuntimeRoot(input.projectDir),
    })
    await ensureDirectoryCopyView({
      viewPath: path.join(input.worktreeDir, SOURCE_PACKAGE_VIEW_NAME),
      sourcePath: paths.sourcePackageAbsolute,
      replaceExistingLinkTargetRoot: ProjectRuntimePaths.projectRuntimeRoot(input.projectDir),
    })
  }
}

async function ensureDirectoryCopyView(input: {
  viewPath: string
  sourcePath: string
  replaceExistingLinkTargetRoot?: string
}): Promise<void> {
  await fs.mkdir(input.sourcePath, { recursive: true })

  const existingTarget = await readLinkTarget(input.viewPath)
  if (existingTarget) {
    if (
      !input.replaceExistingLinkTargetRoot ||
      !(await isExistingLinkTargetUnder(existingTarget, input.replaceExistingLinkTargetRoot))
    ) {
      throw new Error(
        `TaskRuntimeMaterializer: refusing to replace existing source package view ${input.viewPath}; ` +
        `it points at ${existingTarget}`,
      )
    }
    await fs.rm(input.viewPath, { force: true, recursive: true })
  }

  const existing = await fs.lstat(input.viewPath).catch(() => undefined)
  if (existing && !existing.isDirectory()) {
    throw new Error(
      `TaskRuntimeMaterializer: refusing to replace existing non-directory source package view ${input.viewPath}`,
    )
  }

  await fs.mkdir(input.viewPath, { recursive: true })
  await syncDirectoryContents(input.sourcePath, input.viewPath)
}

async function syncDirectoryContents(source: string, target: string): Promise<void> {
  await fs.mkdir(source, { recursive: true })
  await fs.mkdir(target, { recursive: true })
  const sourceEntries = await fs.readdir(source, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  })
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name))
  const targetEntries = await fs.readdir(target, { withFileTypes: true }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  })
  for (const entry of targetEntries) {
    if (sourceNames.has(entry.name)) continue
    await fs.rm(path.join(target, entry.name), { recursive: true, force: true })
  }
  for (const entry of sourceEntries) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true })
      await syncDirectoryContents(sourcePath, targetPath)
      continue
    }
    if (entry.isSymbolicLink()) continue
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.copyFile(sourcePath, targetPath)
  }
}

async function ensureDirectoryLink(input: {
  linkPath: string
  targetPath: string
  replaceExistingLinkTargetRoot?: string
}): Promise<void> {
  await fs.mkdir(input.targetPath, { recursive: true })

  const existingTarget = await readLinkTarget(input.linkPath)
  if (existingTarget) {
    if (await sameRealPath(existingTarget, input.targetPath)) return
    if (
      input.replaceExistingLinkTargetRoot &&
      await isExistingLinkTargetUnder(existingTarget, input.replaceExistingLinkTargetRoot)
    ) {
      await fs.rm(input.linkPath, { force: true, recursive: true })
    } else {
      throw new Error(
        `TaskRuntimeMaterializer: refusing to replace existing runtime view ${input.linkPath}; ` +
        `it points at ${existingTarget}, expected ${input.targetPath}`,
      )
    }
  }

  const refreshedTarget = await readLinkTarget(input.linkPath)
  if (refreshedTarget) {
    if (await sameRealPath(refreshedTarget, input.targetPath)) return
    throw new Error(
      `TaskRuntimeMaterializer: refusing to replace existing runtime view ${input.linkPath}; ` +
      `it points at ${refreshedTarget}, expected ${input.targetPath}`,
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

async function isExistingLinkTargetUnder(targetPath: string, allowedRoot: string): Promise<boolean> {
  const [target, root] = await Promise.all([realOrResolved(targetPath), realOrResolved(allowedRoot)])
  const relative = path.relative(root, target)
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative)
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
  const staleSourcePackageIgnores = new Set([
    `/${SOURCE_PACKAGE_VIEW_NAME}`,
    `/${SOURCE_PACKAGE_VIEW_NAME}/`,
  ])
  const keptLines = existing.split(/\r?\n/).filter((line) => !staleSourcePackageIgnores.has(line.trim()))
  const trimmed = keptLines.map((line) => line.trim())
  const entries = [`/${MIRROR_VIEW_NAME}`, `/${MIRROR_VIEW_NAME}/`].filter((line) => !trimmed.includes(line))
  const changed = keptLines.length !== existing.split(/\r?\n/).length
  if (entries.length === 0 && !changed) return
  const prefix = keptLines.join("\n").trimEnd()
  const next = [
    prefix,
    EXCLUDE_MARKER,
    ...entries,
    "",
  ].filter((line, index) => index !== 0 || line.length > 0).join("\n")
  await fs.writeFile(excludePath, `${next}\n`, "utf8")
}
