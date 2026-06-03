import fs from "node:fs/promises"
import path from "node:path"

import { ProjectRuntimePaths } from "@/project/runtime-paths"

export namespace TaskRuntimeMaterializer {
  export async function webpageEvidenceDir(projectDir: string, taskID: string): Promise<string> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })
    return paths.webpageEvidenceAbsolute
  }

  /** @deprecated Use webpageEvidenceDir. */
  export async function mirrorDir(projectDir: string, taskID: string): Promise<string> {
    return webpageEvidenceDir(projectDir, taskID)
  }

  export async function materializeFrontendDesign(input: {
    projectDir: string
    taskID: string
    worktreeDir: string
  }): Promise<void> {
    const paths = ProjectRuntimePaths.frontendDesignPaths(input.projectDir, input.taskID)
    await fs.mkdir(paths.webpageEvidenceAbsolute, { recursive: true })

    const canonicalDesignDir = path.dirname(paths.webpageEvidenceAbsolute)
    const designView = path.join(input.worktreeDir, paths.relativeDir)
    if (sameResolvedPath(designView, canonicalDesignDir)) return

    await copyRuntimeView({
      sourcePath: canonicalDesignDir,
      viewPath: designView,
    })
  }
}

async function copyRuntimeView(input: {
  sourcePath: string
  viewPath: string
}): Promise<void> {
  await fs.mkdir(input.sourcePath, { recursive: true })

  const existing = await fs.lstat(input.viewPath).catch(() => undefined)
  if (existing) {
    await fs.rm(input.viewPath, { recursive: true, force: true })
  }

  await fs.mkdir(path.dirname(input.viewPath), { recursive: true })
  await fs.cp(input.sourcePath, input.viewPath, { recursive: true, force: true })
}

function sameResolvedPath(a: string, b: string): boolean {
  return key(path.resolve(a)) === key(path.resolve(b))
}

function key(input: string): string {
  const normalized = path.normalize(input)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}
