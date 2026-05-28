import fs from "node:fs/promises"
import path from "node:path"

import type { GeneratedFile } from "../ir/scaffold"

const GENERATED_VIEW_SOURCE_SUBDIR = "generated-view-source"

export async function writeGeneratedSourceFiles(
  outputDir: string,
  files: GeneratedFile[],
  subdir = GENERATED_VIEW_SOURCE_SUBDIR,
): Promise<string[]> {
  validateArtifactSubdir(subdir)
  const root = path.resolve(outputDir, subdir)
  const written: string[] = []

  for (const file of files) {
    const target = resolveArtifactRelative(root, file.file_path)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, file.code, "utf8")
    written.push(target)
  }

  return written
}

function validateArtifactSubdir(subdir: string): void {
  if (subdir.length === 0) throw new Error("Generated source artifact subdir cannot be empty")
  if (path.isAbsolute(subdir)) throw new Error(`Generated source artifact subdir must be relative: ${subdir}`)
  const parts = subdir.split(/[\\/]+/)
  if (parts.includes("..")) throw new Error(`Generated source artifact subdir cannot escape output directory: ${subdir}`)
}

function resolveArtifactRelative(root: string, filePath: string): string {
  if (path.isAbsolute(filePath)) {
    throw new Error(`Generated source artifact path must be relative: ${filePath}`)
  }
  const target = path.resolve(root, filePath)
  const relative = path.relative(root, target)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Generated source artifact path escapes output directory: ${filePath}`)
  }
  return target
}
