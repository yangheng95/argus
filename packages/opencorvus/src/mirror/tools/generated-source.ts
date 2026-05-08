import fs from "node:fs/promises"
import path from "node:path"

import { Instance } from "../../project/instance"
import type { GeneratedFile } from "../ir/scaffold"

export async function writeGeneratedSourceFiles(files: GeneratedFile[]): Promise<string[]> {
  const root = path.resolve(Instance.directory)
  const written: string[] = []

  for (const file of files) {
    const target = resolveWorktreeRelative(root, file.file_path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.code, "utf8")
    written.push(target)
  }

  return written
}

function resolveWorktreeRelative(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Generated source path must be worktree-relative: ${filePath}`)
  }
  const target = path.resolve(root, filePath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated source path escapes worktree: ${filePath}`)
  }
  return target
}
